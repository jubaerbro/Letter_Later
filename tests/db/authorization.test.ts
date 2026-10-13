import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backdate, createLetter, createUser, openDb, type TestDb } from './helpers';

let db: TestDb;
let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;
let mallory: Awaited<ReturnType<typeof createUser>>;
let letterId: string;

beforeAll(async () => {
  db = await openDb();
  alice = await createUser(db, { name: 'Alice' });
  bob = await createUser(db, { name: 'Bob' });
  mallory = await createUser(db, { name: 'Mallory' });
  const res = await createLetter(db, alice.id, { recipient: bob.email, revealMode: 'anonymous' });
  letterId = res.letter_id;
});
afterAll(async () => db?.close());

describe('direct table access is denied to clients', () => {
  const privateTables = [
    'letters', 'letter_contents', 'invitations', 'outbox', 'delivery_events', 'blocks', 'reports',
    'email_suppressions', 'rate_limit_hits', 'app_config', 'nurture_events', 'erasure_log',
  ];
  for (const table of privateTables) {
    it(`authenticated cannot select ${table}`, async () => {
      await expect(db.asUser(bob.id, (q) => q(`select * from public.${table}`))).rejects.toThrow(/permission denied/);
    });
    it(`anon cannot select ${table}`, async () => {
      await expect(db.asAnon((q) => q(`select * from public.${table}`))).rejects.toThrow(/permission denied/);
    });
  }

  it('authenticated cannot insert a letter directly', async () => {
    await expect(
      db.asUser(mallory.id, (q) =>
        q(`insert into public.letters (sender_id, recipient_label, reveal_mode, sender_time_zone, deliver_at, idempotency_key)
           values ($1, 'x', 'name_and_date', 'UTC', now() + interval '1 day', 'abcdefghij')`, [mallory.id]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('users see only their own profile', async () => {
    const rows = await db.asUser(bob.id, (q) => q(`select id from public.profiles`));
    expect(rows.map((r) => r.id)).toEqual([bob.id]);
  });

  it('users cannot change protected profile columns (handle, onboarding)', async () => {
    await expect(
      db.asUser(bob.id, (q) => q(`update public.profiles set handle = 'stolen-name' where id = $1`, [bob.id])),
    ).rejects.toThrow(/permission denied/);
  });

  it('users cannot grant themselves premium', async () => {
    await expect(
      db.asUser(bob.id, (q) => q(`insert into public.entitlements (user_id, premium) values ($1, true)`, [bob.id])),
    ).rejects.toThrow(/permission denied/);
  });

  it('users cannot read other users\' trees directly', async () => {
    const rows = await db.asUser(mallory.id, (q) => q(`select * from public.trees`));
    expect(rows).toHaveLength(0);
  });
});

describe('privileged functions are not callable by clients', () => {
  const serviceOnly = [
    `select public.create_letter_record(null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null)`,
    `select public.claim_due_letters('w', 10)`,
    `select public.complete_letter_delivery(gen_random_uuid(), 'w', null, null)`,
    `select public.mark_due_letters()`,
    `select public.claim_outbox('w', 10)`,
    `select public.upsert_entitlement(gen_random_uuid(), true, null, null, null, null)`,
    `select public.delete_user_data(gen_random_uuid())`,
    `select public.letter_content_access(gen_random_uuid(), gen_random_uuid())`,
    `select public.mark_letter_opened(gen_random_uuid(), gen_random_uuid())`,
    `select public.admin_retry_letter(gen_random_uuid())`,
    `select public.erase_email_address('a@b.co')`,
  ];
  for (const sql of serviceOnly) {
    it(`denies: ${sql.slice(7, 60)}`, async () => {
      await expect(db.asUser(mallory.id, (q) => q(sql))).rejects.toThrow(/permission denied/);
    });
  }

  it('anon cannot read a mailbox', async () => {
    await expect(db.asAnon((q) => q(`select * from public.mailbox()`))).rejects.toThrow(/permission denied/);
  });
});

describe('mailbox applies privacy rules', () => {
  it('recipient sees an anonymous letter without the sender identity', async () => {
    const rows = await db.asUser(bob.id, (q) => q(`select * from public.mailbox()`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'received', is_anonymous: true, counterpart_name: null, counterpart_handle: null });
    expect(JSON.stringify(rows[0])).not.toContain(alice.id);
  });

  it('sender sees their sent letter', async () => {
    const rows = await db.asUser(alice.id, (q) => q(`select * from public.mailbox()`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'sent', display_status: 'waiting' });
  });

  it('an unrelated user sees nothing', async () => {
    const rows = await db.asUser(mallory.id, (q) => q(`select * from public.mailbox()`));
    expect(rows).toHaveLength(0);
    const single = await db.asUser(mallory.id, (q) => q(`select * from public.mailbox($1)`, [letterId]));
    expect(single).toHaveLength(0);
  });
});

describe('letter content access', () => {
  const access = (userId: string, id: string, now = new Date()) =>
    db.asService((q) => q(`select public.letter_content_access($1, $2, $3) as r`, [userId, id, now])).then((r) => r[0].r);

  it('sender can always read their own letter', async () => {
    expect(await access(alice.id, letterId)).toMatchObject({ ok: true, role: 'sender' });
  });

  it('recipient cannot read a sealed letter before delivery', async () => {
    expect(await access(bob.id, letterId)).toEqual({ ok: false, error: 'not_found' });
  });

  it('a stranger gets the same not_found answer', async () => {
    expect(await access(mallory.id, letterId)).toEqual({ ok: false, error: 'not_found' });
  });

  it('recipient cannot read even if status says delivered but the time has not come', async () => {
    const { letter_id } = await createLetter(db, alice.id, { recipient: bob.email });
    await db.sql(`update public.letters set status = 'due' where id = $1`, [letter_id]);
    await db.sql(`update public.letters set status = 'sending' where id = $1`, [letter_id]);
    await db.sql(`update public.letters set status = 'delivered' where id = $1`, [letter_id]);
    expect(await access(bob.id, letter_id)).toEqual({ ok: false, error: 'not_found' });
  });

  it('recipient can read after delivery, and opening is recorded once', async () => {
    const { letter_id } = await createLetter(db, alice.id, { recipient: bob.email });
    await backdate(db, letter_id, new Date(Date.now() - 60_000));
    await db.asService((q) => q(`select public.mark_due_letters()`));
    await db.asService((q) => q(`select * from public.claim_due_letters('w1', 10)`));
    await db.asService((q) => q(`select public.complete_letter_delivery($1, 'w1', null, null)`, [letter_id]));
    const first = await access(bob.id, letter_id);
    expect(first).toMatchObject({ ok: true, role: 'recipient', first_open: true });
    const opened = await db.asService((q) => q(`select public.mark_letter_opened($1, $2) as r`, [bob.id, letter_id]));
    expect(opened[0].r).toBe(true);
    const again = await db.asService((q) => q(`select public.mark_letter_opened($1, $2) as r`, [bob.id, letter_id]));
    expect(again[0].r).toBe(false);
    expect(await access(bob.id, letter_id)).toMatchObject({ ok: true, first_open: false });
  });
});
