import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLetter, createUser, openDb, type TestDb } from './helpers';

let db: TestDb;
let sender: Awaited<ReturnType<typeof createUser>>;
let recipient: Awaited<ReturnType<typeof createUser>>;
let letterId: string;

beforeAll(async () => {
  db = await openDb();
  sender = await createUser(db, { name: 'Sender' });
  recipient = await createUser(db, { name: 'Recipient' });
  letterId = (await createLetter(db, sender.id, { recipient: recipient.email, revealMode: 'name_subject_date', subject: 'For your 30th' })).letter_id;
});
afterAll(async () => db?.close());

describe('a sent letter cannot be changed — not even by the service role or a superuser', () => {
  const edits: Array<[string, string]> = [
    ['reschedule', `deliver_at = deliver_at + interval '1 day'`],
    ['make earlier', `deliver_at = deliver_at - interval '1 hour'`],
    ['change reveal mode', `reveal_mode = 'anonymous', envelope_sender_name = null, envelope_sender_handle = null`],
    ['change subject', `envelope_subject = 'something else'`],
    ['change sender name', `envelope_sender_name = 'Someone Else'`],
    ['change time zone', `sender_time_zone = 'Asia/Tokyo'`],
    ['re-point recipient', `recipient_email = 'other@example.com'`],
  ];
  for (const [label, set] of edits) {
    it(`rejects: ${label} (service role)`, async () => {
      await expect(db.asService((q) => q(`update public.letters set ${set} where id = $1`, [letterId]))).rejects.toThrow(
        /letter_immutable/,
      );
    });
    it(`rejects: ${label} (superuser)`, async () => {
      await expect(db.sql(`update public.letters set ${set} where id = $1`, [letterId])).rejects.toThrow(/letter_immutable/);
    });
  }

  it('rejects editing the encrypted content', async () => {
    await expect(db.sql(`update public.letter_contents set ciphertext = 'x' where letter_id = $1`, [letterId])).rejects.toThrow(
      /append_only/,
    );
  });

  it('rejects re-pointing the recipient to another user', async () => {
    const other = await createUser(db);
    await expect(db.sql(`update public.letters set recipient_id = $2 where id = $1`, [letterId, other.id])).rejects.toThrow(
      /letter_immutable/,
    );
  });

  it('rejects illegal status jumps (e.g. scheduled → delivered, opened → scheduled)', async () => {
    await expect(db.sql(`update public.letters set status = 'delivered' where id = $1`, [letterId])).rejects.toThrow(
      /invalid_status_transition/,
    );
    await expect(db.sql(`update public.letters set status = 'opened' where id = $1`, [letterId])).rejects.toThrow(
      /invalid_status_transition/,
    );
  });

  it('the audit trail is append-only', async () => {
    await expect(db.sql(`update public.delivery_events set event = 'tampered' where letter_id = $1`, [letterId])).rejects.toThrow(
      /append_only/,
    );
  });

  it('clients have no API to edit, reschedule or cancel', async () => {
    const fns = await db.sql<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')`,
    );
    const names = fns.map((f) => f.proname);
    for (const forbidden of ['reschedule', 'cancel', 'edit', 'update_letter']) {
      expect(names.some((n) => n.includes(forbidden))).toBe(false);
    }
  });
});

describe('schedule validation', () => {
  it('rejects delivery sooner than the minimum lead time', async () => {
    await expect(createLetter(db, sender.id, { recipient: recipient.email, deliverAt: new Date(Date.now() + 60_000) })).rejects.toThrow(
      /deliver_at_too_soon/,
    );
  });

  it('rejects delivery in the past', async () => {
    await expect(createLetter(db, sender.id, { recipient: recipient.email, deliverAt: new Date(Date.now() - 1000) })).rejects.toThrow(
      /deliver_at_too_soon/,
    );
  });

  it('rejects delivery beyond 50 years', async () => {
    const far = new Date();
    far.setFullYear(far.getFullYear() + 51);
    await expect(createLetter(db, sender.id, { recipient: recipient.email, deliverAt: far })).rejects.toThrow(/deliver_at_too_far/);
  });

  it('accepts a letter 25 years away and stores the exact instant', async () => {
    const far = new Date('2051-02-28T23:30:00Z');
    const { letter_id } = await createLetter(db, sender.id, { recipient: recipient.email, deliverAt: far });
    const [row] = await db.sql(`select deliver_at from public.letters where id = $1`, [letter_id]);
    expect((row.deliver_at as Date).toISOString()).toBe('2051-02-28T23:30:00.000Z');
  });

  it('a short test schedule works when the lead time is configured lower (development)', async () => {
    await db.sql(`update public.app_config set value = '30' where key = 'min_delivery_lead_seconds'`);
    const { ok } = await createLetter(db, sender.id, { recipient: recipient.email, deliverAt: new Date(Date.now() + 45_000) });
    expect(ok).toBe(true);
    await db.sql(`update public.app_config set value = '3600' where key = 'min_delivery_lead_seconds'`);
  });

  it('is idempotent: the same idempotency key returns the same letter', async () => {
    const a = await createLetter(db, sender.id, { recipient: recipient.email, idempotencyKey: 'same-key-123' });
    const b = await createLetter(db, sender.id, { recipient: recipient.email, idempotencyKey: 'same-key-123' });
    expect(b.letter_id).toBe(a.letter_id);
    expect(b.duplicate).toBe(true);
  });
});

describe('nurturing never changes the delivery date', () => {
  it('deliver_at is identical after every kind of care, including premium', async () => {
    const [before] = await db.sql(`select deliver_at from public.letters where id = $1`, [letterId]);
    await db.asService((q) => q(`select public.upsert_entitlement($1, true, 'plus_monthly', 'play_store', null, 'evt')`, [sender.id]));
    const [tree] = await db.sql(`select id from public.trees where letter_id = $1 and owner_id = $2`, [letterId, sender.id]);
    for (const kind of ['water', 'sunlight', 'moment']) {
      const [r] = await db.asUser(sender.id, (q) => q(`select public.nurture_tree($1, $2) as r`, [tree.id, kind]));
      expect(r.r.ok).toBe(true);
    }
    const [after] = await db.sql(`select deliver_at, status from public.letters where id = $1`, [letterId]);
    expect(after.deliver_at).toEqual(before.deliver_at);
    expect(after.status).toBe('scheduled');
  });
});
