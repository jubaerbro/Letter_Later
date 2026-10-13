import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backdate, createLetter, createUser, newToken, openDb, type TestDb } from './helpers';

let db: TestDb;
let sender: Awaited<ReturnType<typeof createUser>>;
let recipient: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  db = await openDb();
  await db.sql(`update public.app_config set value = '1000' where key in ('max_letters_per_day', 'max_letters_same_recipient_per_week', 'max_new_invites_per_day')`);
  sender = await createUser(db, { name: 'Sender' });
  recipient = await createUser(db, { name: 'Recipient' });
});
afterAll(async () => db?.close());

async function dueLetter(to = recipient.email) {
  const { letter_id } = await createLetter(db, sender.id, { recipient: to });
  await backdate(db, letter_id, new Date(Date.now() - 1000));
  return letter_id;
}
const svc = <T = any>(sql: string, params: unknown[] = []) => db.asService((q) => q<T & object>(sql, params));
const status = async (id: string) => (await db.sql(`select status, attempts, next_attempt_at, last_error from public.letters where id = $1`, [id]))[0];

describe('scheduling states', () => {
  it('scheduled letters in the future are not touched', async () => {
    const { letter_id } = await createLetter(db, sender.id, { recipient: recipient.email });
    await svc(`select public.mark_due_letters()`);
    const claimed = await svc(`select * from public.claim_due_letters('w', 100)`);
    expect(claimed.map((r: any) => r.letter_id)).not.toContain(letter_id);
    expect((await status(letter_id)).status).toBe('scheduled');
  });

  it('scheduled → due → sending → delivered', async () => {
    const id = await dueLetter();
    await svc(`select public.mark_due_letters()`);
    expect((await status(id)).status).toBe('due');
    const claimed = await svc(`select * from public.claim_due_letters('w', 100)`);
    expect(claimed.map((r: any) => r.letter_id)).toContain(id);
    expect((await status(id)).status).toBe('sending');
    const [res] = await svc(`select public.complete_letter_delivery($1, 'w', null, null) as r`, [id]);
    expect(res.r).toBe('delivered');
    expect((await status(id)).status).toBe('delivered');
    const events = await db.sql(`select event from public.delivery_events where letter_id = $1 order by id`, [id]);
    expect(events.map((e) => e.event)).toEqual(['created', 'recipient_notified', 'due', 'delivered']);
  });

  it('honours an accelerated clock passed by the worker (test clock)', async () => {
    const { letter_id } = await createLetter(db, sender.id, { recipient: recipient.email, deliverAt: new Date(Date.now() + 2 * 3600_000) });
    const future = new Date(Date.now() + 3 * 3600_000);
    await svc(`select public.mark_due_letters($1)`, [future]);
    const claimed = await svc(`select * from public.claim_due_letters('w', 100, $1)`, [future]);
    expect(claimed.map((r: any) => r.letter_id)).toContain(letter_id);
  });
});

describe('duplicate delivery is impossible', () => {
  it('completing twice is a no-op the second time', async () => {
    const id = await dueLetter();
    await svc(`select public.mark_due_letters()`);
    await svc(`select * from public.claim_due_letters('w', 100)`);
    const [a] = await svc(`select public.complete_letter_delivery($1, 'w', null, null) as r`, [id]);
    const [b] = await svc(`select public.complete_letter_delivery($1, 'w', null, null) as r`, [id]);
    expect(a.r).toBe('delivered');
    expect(b.r).toBe('noop');
    const notes = await db.sql(`select count(*)::int as n from public.notifications where letter_id = $1 and kind = 'letter_arrived'`, [id]);
    expect(notes[0].n).toBe(1);
    const mails = await db.sql(`select count(*)::int as n from public.outbox where letter_id = $1 and template = 'letter_arrived'`, [id]);
    expect(mails[0].n).toBe(1);
  });

  it('a worker that does not own the lock cannot complete', async () => {
    const id = await dueLetter();
    await svc(`select public.mark_due_letters()`);
    await svc(`select * from public.claim_due_letters('owner', 100)`);
    const [r] = await svc(`select public.complete_letter_delivery($1, 'intruder', null, null) as r`, [id]);
    expect(r.r).toBe('noop');
    expect((await status(id)).status).toBe('sending');
  });

  it('concurrent workers claim disjoint sets (FOR UPDATE SKIP LOCKED)', async () => {
    const ids = await Promise.all(Array.from({ length: 12 }, () => dueLetter()));
    await svc(`select public.mark_due_letters()`);
    const c1 = await db.newClient();
    const c2 = await db.newClient();
    await c1.query('begin');
    await c2.query('begin');
    const r1 = await c1.query(`select * from public.claim_due_letters('w1', 7)`);
    const r2 = await c2.query(`select * from public.claim_due_letters('w2', 100)`);
    await c1.query('commit');
    await c2.query('commit');
    const s1 = new Set(r1.rows.map((r) => r.letter_id));
    const s2 = new Set(r2.rows.map((r) => r.letter_id));
    for (const id of s1) expect(s2.has(id)).toBe(false);
    for (const id of ids) expect(s1.has(id) || s2.has(id)).toBe(true);
  });

  it('a crashed worker\'s stale lock is reclaimed after 5 minutes, not before', async () => {
    const id = await dueLetter();
    await svc(`select public.mark_due_letters()`);
    await svc(`select * from public.claim_due_letters('crashed', 100)`);
    const soon = await svc(`select * from public.claim_due_letters('rescuer', 100, now() + interval '1 minute')`);
    expect(soon.map((r: any) => r.letter_id)).not.toContain(id);
    const later = await svc(`select * from public.claim_due_letters('rescuer', 100, now() + interval '6 minutes')`);
    expect(later.map((r: any) => r.letter_id)).toContain(id);
    const [late] = await svc(`select public.complete_letter_delivery($1, 'crashed', null, null) as r`, [id]);
    expect(late.r).toBe('noop');
    const [ok] = await svc(`select public.complete_letter_delivery($1, 'rescuer', null, null) as r`, [id]);
    expect(ok.r).toBe('delivered');
  });
});

describe('retries and failure', () => {
  it('a failed attempt goes back to due with exponential backoff', async () => {
    const id = await dueLetter();
    await svc(`select public.mark_due_letters()`);
    await svc(`select * from public.claim_due_letters('w', 100)`);
    const [r] = await svc(`select public.fail_letter_delivery($1, 'w', 'transient db error') as r`, [id]);
    expect(r.r).toBe('retry');
    const s = await status(id);
    expect(s.status).toBe('due');
    const delayMs = new Date(s.next_attempt_at).getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(50_000);
    expect(delayMs).toBeLessThan(70_000);
    const immediate = await svc(`select * from public.claim_due_letters('w', 100)`);
    expect(immediate.map((x: any) => x.letter_id)).not.toContain(id);
  });

  it('after max attempts the letter is failed and shows in the admin view; admin retry requeues it', async () => {
    const id = await dueLetter();
    await svc(`select public.mark_due_letters()`);
    let now = new Date();
    for (let i = 0; i < 8; i++) {
      const claimed = await svc(`select * from public.claim_due_letters('w', 100, $1)`, [now]);
      expect(claimed.map((x: any) => x.letter_id)).toContain(id);
      await svc(`select public.fail_letter_delivery($1, 'w', 'boom', $2)`, [id, now]);
      now = new Date(now.getTime() + 7 * 3600_000);
    }
    expect((await status(id)).status).toBe('failed');
    const senderView = await db.asUser(sender.id, (q) => q(`select display_status from public.mailbox($1)`, [id]));
    expect(senderView[0].display_status).toBe('delayed');
    const recipientView = await db.asUser(recipient.id, (q) => q(`select display_status from public.mailbox($1)`, [id]));
    expect(recipientView[0].display_status).toBe('waiting');
    const issues = await db.sql(`select * from public.admin_delivery_issues where id = $1`, [id]);
    expect(issues).toHaveLength(1);
    const [r] = await svc(`select public.admin_retry_letter($1) as r`, [id]);
    expect(r.r).toBe('requeued');
    expect((await status(id)).status).toBe('due');
  });
});

describe('unclaimed recipients and blocked senders', () => {
  it('delivery to an unregistered email creates a fresh claim link and queues the arrival email', async () => {
    const id = await dueLetter('not-yet@example.com');
    await svc(`select public.mark_due_letters()`);
    await svc(`select * from public.claim_due_letters('w', 100)`);
    const tok = newToken();
    const [r] = await svc(`select public.complete_letter_delivery($1, 'w', $2, 'enc') as r`, [id, tok.hash]);
    expect(r.r).toBe('delivered');
    const inv = await db.sql(`select purpose from public.invitations where letter_id = $1 order by created_at`, [id]);
    expect(inv.map((i) => i.purpose)).toEqual(['invite', 'arrival']);
    const out = await db.sql(`select to_email, status from public.outbox where idempotency_key = $1`, [`arrival-email:${id}`]);
    expect(out[0]).toMatchObject({ to_email: 'not-yet@example.com', status: 'queued' });
  });

  it('a letter whose recipient blocked the sender in the meantime is suppressed, not delivered', async () => {
    const id = await dueLetter();
    await db.sql(`insert into public.blocks (blocker_id, blocked_user_id, label) values ($1, $2, 'x')`, [recipient.id, sender.id]);
    await svc(`select public.mark_due_letters()`);
    await svc(`select * from public.claim_due_letters('w', 100)`);
    const [r] = await svc(`select public.complete_letter_delivery($1, 'w', null, null) as r`, [id]);
    expect(r.r).toBe('suppressed');
    await db.sql(`delete from public.blocks where blocker_id = $1`, [recipient.id]);
  });
});

describe('outbox (email/push) processing', () => {
  it('claims, completes, and never sends the same message twice', async () => {
    const { letter_id } = await createLetter(db, sender.id, { recipient: 'fresh-outbox@example.com' });
    const claimed = await svc(`select * from public.claim_outbox('mailer', 10, now(), $1)`, [letter_id]);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ template: 'invitation', to_email: 'fresh-outbox@example.com' });
    expect(JSON.stringify(claimed[0].params)).not.toMatch(/Y2lwaGVydGV4dA/); // never letter ciphertext/content
    const again = await svc(`select * from public.claim_outbox('mailer2', 10, now(), $1)`, [letter_id]);
    expect(again).toHaveLength(0);
    const [done] = await svc(`select public.complete_outbox($1, 'mailer', 'prov_123') as r`, [claimed[0].id]);
    expect(done.r).toBe('provider_accepted');
    const [dup] = await svc(`select public.complete_outbox($1, 'mailer', 'prov_123') as r`, [claimed[0].id]);
    expect(dup.r).toBe('noop');
    const rows = await db.asUser(sender.id, (q) => q(`select invite_status from public.mailbox($1)`, [letter_id]));
    expect(rows[0].invite_status).toBe('provider_accepted');
  });

  it('transient failures retry with backoff; permanent failures stop', async () => {
    const { letter_id } = await createLetter(db, sender.id, { recipient: 'flaky@example.com' });
    const [job] = await svc(`select * from public.claim_outbox('m', 10, now(), $1)`, [letter_id]);
    const [r1] = await svc(`select public.fail_outbox($1, 'm', 'HTTP 503', false) as r`, [job.id]);
    expect(r1.r).toBe('retry');
    const [job2] = await svc(`select * from public.claim_outbox('m', 10, now() + interval '2 minutes', $1)`, [letter_id]);
    expect(job2.id).toBe(job.id);
    const [r2] = await svc(`select public.fail_outbox($1, 'm', 'HTTP 422 invalid address', true) as r`, [job.id]);
    expect(r2.r).toBe('failed');
  });

  it('opted-out addresses are skipped', async () => {
    await svc(`select public.suppress_email('optout@example.com')`);
    const { letter_id } = await createLetter(db, sender.id, { recipient: 'optout@example.com' });
    const [row] = await db.sql(`select status, last_error from public.outbox where letter_id = $1`, [letter_id]);
    expect(row).toMatchObject({ status: 'skipped', last_error: 'address_opted_out' });
  });
});
