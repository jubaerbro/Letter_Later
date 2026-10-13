import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backdate, createLetter, createUser, openDb, type TestDb } from './helpers';

let db: TestDb;
let sender: Awaited<ReturnType<typeof createUser>>;
let recipient: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  db = await openDb();
  await db.sql(`update public.app_config set value = '1000' where key = 'max_letters_same_recipient_per_week'`);
  sender = await createUser(db, { name: 'Sender' });
  recipient = await createUser(db, { name: 'Recipient' });
});
afterAll(async () => db?.close());

async function acceptedLetter() {
  const { letter_id } = await createLetter(db, sender.id, { recipient: recipient.email });
  await db.asUser(recipient.id, (q) => q(`select public.accept_letter($1)`, [letter_id]));
  const trees = await db.sql(`select id, owner_id from public.trees where letter_id = $1`, [letter_id]);
  return {
    letterId: letter_id,
    senderTree: trees.find((t) => t.owner_id === sender.id)!.id as string,
    recipientTree: trees.find((t) => t.owner_id === recipient.id)!.id as string,
  };
}
const nurture = (userId: string, treeId: string, kind: string) =>
  db.asUser(userId, (q) => q(`select public.nurture_tree($1, $2) as r`, [treeId, kind])).then((r) => r[0].r);

describe('trees', () => {
  it('each participant nurtures their own tree, once per kind per day, with no penalties', async () => {
    const t = await acceptedLetter();
    expect(await nurture(sender.id, t.senderTree, 'water')).toMatchObject({ ok: true, added: 1, points: 1 });
    expect(await nurture(sender.id, t.senderTree, 'water')).toMatchObject({ ok: true, added: 0, already_today: true, points: 1 });
    expect(await nurture(sender.id, t.senderTree, 'moment')).toMatchObject({ ok: true, added: 2, points: 3 });
    expect(await nurture(recipient.id, t.recipientTree, 'sunlight')).toMatchObject({ ok: true, points: 1 });
  });

  it('nobody can nurture someone else\'s tree', async () => {
    const t = await acceptedLetter();
    expect(await nurture(recipient.id, t.senderTree, 'water')).toEqual({ ok: false, error: 'not_found' });
  });

  it('each can see the other\'s tree growth through the mailbox', async () => {
    const t = await acceptedLetter();
    await nurture(sender.id, t.senderTree, 'moment');
    const [view] = await db.asUser(recipient.id, (q) => q(`select their_tree_points, my_tree_points from public.mailbox($1)`, [t.letterId]));
    expect(view).toEqual({ their_tree_points: 2, my_tree_points: 0 });
  });

  it('premium doubles visual growth points (server-verified entitlement only)', async () => {
    const t = await acceptedLetter();
    await db.asService((q) => q(`select public.upsert_entitlement($1, true, 'plus', 'play_store', now() + interval '30 days', 'e1')`, [recipient.id]));
    expect(await nurture(recipient.id, t.recipientTree, 'water')).toMatchObject({ added: 2 });
    await db.asService((q) => q(`select public.upsert_entitlement($1, true, 'plus', 'play_store', now() - interval '1 day', 'e2')`, [recipient.id]));
    expect(await nurture(recipient.id, t.recipientTree, 'sunlight')).toMatchObject({ added: 1 });
  });

  it('styles unlock gently; locked styles are refused', async () => {
    const t = await acceptedLetter();
    const styles = await db.asUser(recipient.id, (q) => q(`select style, unlocked from public.my_tree_styles()`));
    expect(styles.find((s) => s.style === 'oak')!.unlocked).toBe(true);
    expect(styles.find((s) => s.style === 'starlight')!.unlocked).toBe(false);
    const [r] = await db.asUser(recipient.id, (q) => q(`select public.set_tree_style($1, 'starlight') as r`, [t.recipientTree]));
    expect(r.r).toEqual({ ok: false, error: 'style_locked' });
    const [ok] = await db.asUser(recipient.id, (q) => q(`select public.set_tree_style($1, 'cherry') as r`, [t.recipientTree]));
    expect(ok.r).toEqual({ ok: true });
  });

  it('after the letter arrives the tree is in bloom and no longer needs care', async () => {
    const t = await acceptedLetter();
    await backdate(db, t.letterId, new Date(Date.now() - 1000));
    await db.asService((q) => q(`select public.mark_due_letters()`));
    await db.asService((q) => q(`select * from public.claim_due_letters('w', 100)`));
    await db.asService((q) => q(`select public.complete_letter_delivery($1, 'w', null, null)`, [t.letterId]));
    expect(await nurture(recipient.id, t.recipientTree, 'water')).toMatchObject({ ok: false, error: 'already_bloomed' });
  });
});

describe('blocking and reporting', () => {
  it('blocking suppresses pending letters, hides them, and prevents new ones without revealing why', async () => {
    const harasser = await createUser(db, { name: 'Harasser' });
    const victim = await createUser(db, { name: 'Victim' });
    const a = await createLetter(db, harasser.id, { recipient: victim.email, revealMode: 'anonymous' });
    const b = await createLetter(db, harasser.id, { recipient: victim.email });

    const [res] = await db.asUser(victim.id, (q) => q(`select public.block_sender_of_letter($1) as r`, [a.letter_id]));
    expect(res.r).toEqual({ ok: true });

    const statuses = await db.sql(`select status, suppressed_reason from public.letters where id = any($1)`, [[a.letter_id, b.letter_id]]);
    expect(statuses.every((s) => s.status === 'suppressed' && s.suppressed_reason === 'recipient_blocked')).toBe(true);
    expect(await db.asUser(victim.id, (q) => q(`select * from public.mailbox()`))).toHaveLength(0);

    const blocks = await db.asUser(victim.id, (q) => q(`select label from public.my_blocks()`));
    expect(blocks[0].label).toMatch(/^Anonymous sender/);
    expect(JSON.stringify(blocks)).not.toContain('Harasser');

    await expect(createLetter(db, harasser.id, { recipient: victim.email })).rejects.toThrow(/recipient_unavailable/);
    await expect(createLetter(db, harasser.id, { recipientKind: 'handle', recipient: victim.handle })).rejects.toThrow(/recipient_not_found|recipient_unavailable/);
    const [lookup] = await db.asUser(harasser.id, (q) => q(`select public.resolve_recipient($1) as r`, [victim.handle]));
    expect(lookup.r).toEqual({ ok: false, error: 'not_found' });

    const senderView = await db.asUser(harasser.id, (q) => q(`select display_status from public.mailbox()`));
    expect(senderView.map((r) => r.display_status)).toEqual(['closed', 'closed']);
  });

  it('only participants can report, and reports keep the sender identity server-side', async () => {
    const stranger = await createUser(db);
    const { letter_id } = await createLetter(db, sender.id, { recipient: recipient.email, revealMode: 'anonymous' });
    const [denied] = await db.asUser(stranger.id, (q) => q(`select public.report_letter($1, 'spam', null) as r`, [letter_id]));
    expect(denied.r).toEqual({ ok: false, error: 'not_found' });
    const [ok] = await db.asUser(recipient.id, (q) => q(`select public.report_letter($1, 'harassment', 'unwanted') as r`, [letter_id]));
    expect(ok.r).toEqual({ ok: true });
    const [report] = await db.sql(`select reported_user_id, reason from public.reports where letter_id = $1`, [letter_id]);
    expect(report).toEqual({ reported_user_id: sender.id, reason: 'harassment' });
  });
});

describe('anti-abuse limits and identity', () => {
  it('limits letters per day', async () => {
    const spammer = await createUser(db);
    await db.sql(`update public.app_config set value = '3' where key = 'max_letters_per_day'`);
    for (let i = 0; i < 3; i++) await createLetter(db, spammer.id, { recipient: `p${i}@example.com` });
    await expect(createLetter(db, spammer.id, { recipient: 'p9@example.com' })).rejects.toThrow(/rate_limited_daily/);
    await db.sql(`update public.app_config set value = '20' where key = 'max_letters_per_day'`);
  });

  it('limits invitation emails to one address from many senders', async () => {
    for (let i = 0; i < 4; i++) {
      const s = await createUser(db);
      await createLetter(db, s.id, { recipient: 'popular@example.com' });
    }
    const rows = await db.sql(`select status from public.outbox where to_email = 'popular@example.com' order by created_at`);
    expect(rows.map((r) => r.status)).toEqual(['queued', 'queued', 'queued', 'skipped']);
  });

  it('senders must be onboarded with a verified email', async () => {
    const unverified = await createUser(db, { confirmed: false, onboard: false });
    await expect(createLetter(db, unverified.id, { recipient: 'x@example.com' })).rejects.toThrow(/sender_not_ready/);
  });

  it('reserved names cannot be used to impersonate the service', async () => {
    const u = await createUser(db, { onboard: false });
    const [r] = await db.asUser(u.id, (q) => q(`select public.complete_onboarding('Letter Later Team', 'UTC', 'north', true, true) as r`));
    expect(r.r).toEqual({ ok: false, error: 'display_name_reserved' });
    await db.asUser(u.id, (q) => q(`update public.profiles set display_name = 'Sam Rivers' where id = $1`, [u.id]));
    await expect(db.asUser(u.id, (q) => q(`update public.profiles set display_name = 'Support' where id = $1`, [u.id]))).rejects.toThrow(
      /display_name_reserved/,
    );
  });

  it('onboarding requires terms, age confirmation and a real time zone', async () => {
    const u = await createUser(db, { onboard: false });
    const call = (terms: boolean, age: boolean, tz = 'UTC') =>
      db.asUser(u.id, (q) => q(`select public.complete_onboarding('Sam', $1, 'north', $2, $3) as r`, [tz, terms, age])).then((r) => r[0].r);
    expect(await call(false, true)).toMatchObject({ error: 'terms_required' });
    expect(await call(true, false)).toMatchObject({ error: 'age_required' });
    expect(await call(true, true, 'Mars/Olympus')).toMatchObject({ error: 'time_zone_invalid' });
    expect(await call(true, true, 'America/New_York')).toEqual({ ok: true });
  });

  it('personal addresses can change, with validation and a cooldown', async () => {
    const u = await createUser(db);
    const change = (h: string) => db.asUser(u.id, (q) => q(`select public.change_handle($1) as r`, [h])).then((r) => r[0].r);
    expect(await change('Bad Handle!')).toMatchObject({ error: 'handle_invalid' });
    expect(await change('admin')).toMatchObject({ error: 'handle_reserved' });
    expect(await change(sender.handle)).toMatchObject({ error: 'handle_taken' });
    expect(await change('morning-light')).toEqual({ ok: true, handle: 'morning-light' });
    expect(await change('evening-light')).toMatchObject({ error: 'handle_cooldown' });
  });

  it('handle lookup is exact-match only and rate limited (no directory)', async () => {
    const u = await createUser(db);
    const [partial] = await db.asUser(u.id, (q) => q(`select public.resolve_recipient($1) as r`, [sender.handle.slice(0, 4)]));
    expect(partial.r).toEqual({ ok: false, error: 'not_found' });
    for (let i = 0; i < 29; i++) await db.asUser(u.id, (q) => q(`select public.resolve_recipient('nobody-here-1')`));
    const [limited] = await db.asUser(u.id, (q) => q(`select public.resolve_recipient($1) as r`, [sender.handle]));
    expect(limited.r).toEqual({ ok: false, error: 'rate_limited' });
  });
});

describe('account deletion', () => {
  it('erases the user, cancels their undelivered letters, and keeps delivered letters for recipients', async () => {
    const leaving = await createUser(db, { name: 'Leaving' });
    const friend = await createUser(db, { name: 'Friend' });
    const pending = await createLetter(db, leaving.id, { recipient: friend.email });
    const delivered = await createLetter(db, leaving.id, { recipient: friend.email });
    await backdate(db, delivered.letter_id, new Date(Date.now() - 1000));
    await db.asService((q) => q(`select public.mark_due_letters()`));
    await db.asService((q) => q(`select * from public.claim_due_letters('w', 100)`));
    await db.asService((q) => q(`select public.complete_letter_delivery($1, 'w', null, null)`, [delivered.letter_id]));
    const incoming = await createLetter(db, friend.id, { recipient: leaving.email });

    const [res] = await db.asService((q) => q(`select public.delete_user_data($1) as r`, [leaving.id]));
    expect(res.r.letters_deleted).toBe(1);
    await db.sql(`delete from auth.users where id = $1`, [leaving.id]);

    expect(await db.sql(`select 1 from public.letters where id = $1`, [pending.letter_id])).toHaveLength(0);
    expect(await db.sql(`select 1 from public.letter_contents where letter_id = $1`, [pending.letter_id])).toHaveLength(0);
    const [kept] = await db.sql(`select sender_id, status from public.letters where id = $1`, [delivered.letter_id]);
    expect(kept).toEqual({ sender_id: null, status: 'delivered' });
    const [inc] = await db.sql(`select recipient_id, recipient_email, status from public.letters where id = $1`, [incoming.letter_id]);
    expect(inc).toEqual({ recipient_id: null, recipient_email: null, status: 'suppressed' });
    expect(await db.sql(`select 1 from public.profiles where id = $1`, [leaving.id])).toHaveLength(0);
    const [log] = await db.sql(`select kind from public.erasure_log order by id desc limit 1`);
    expect(log.kind).toBe('account_deletion');
  });
});
