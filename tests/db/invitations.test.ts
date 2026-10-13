import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLetter, createUser, openDb, type TestDb } from './helpers';

let db: TestDb;
let sender: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  db = await openDb();
  sender = await createUser(db, { name: 'Maya' });
});
afterAll(async () => db?.close());

const preview = (token: string) => db.asAnon((q) => q(`select public.invitation_preview($1) as r`, [token])).then((r) => r[0].r);
const claim = (userId: string, token: string) =>
  db.asUser(userId, (q) => q(`select public.claim_invitation($1) as r`, [token])).then((r) => r[0].r);

describe('letters to people without an account', () => {
  it('creates a pending invitation and queues the email immediately, without content', async () => {
    const res = await createLetter(db, sender.id, {
      recipient: 'Newcomer@Example.com ',
      revealMode: 'name_subject_date',
      subject: 'Open on graduation day',
    });
    expect(res).toMatchObject({ ok: true, invited: true });
    const [letter] = await db.sql(`select recipient_id, recipient_email from public.letters where id = $1`, [res.letter_id]);
    expect(letter).toEqual({ recipient_id: null, recipient_email: 'newcomer@example.com' });
    const [inv] = await db.sql(`select token_hash, expires_at from public.invitations where letter_id = $1`, [res.letter_id]);
    expect(inv.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.token_hash).not.toContain(res.token);
    const [mail] = await db.sql(`select template, status, params from public.outbox where letter_id = $1`, [res.letter_id]);
    expect(mail).toMatchObject({ template: 'invitation', status: 'queued' });
    expect(Object.keys(mail.params)).toEqual(['token_enc']);
  });

  it('the public preview shows only what the sender chose to reveal', async () => {
    const anon = await createLetter(db, sender.id, { recipient: 'secret@example.com', revealMode: 'anonymous' });
    const p = await preview(anon.token);
    expect(p).toMatchObject({ ok: true, sender_name: null, sender_handle: null, subject: null, preview: null, claimed: false });
    expect(p.email_hint).toBe('s•••@example.com');

    const named = await createLetter(db, sender.id, { recipient: 'secret2@example.com', revealMode: 'name_and_preview', preview: 'A little note…' });
    expect(await preview(named.token)).toMatchObject({ sender_name: 'Maya', subject: null, preview: 'A little note…' });
  });

  it('rejects malformed and unknown tokens identically', async () => {
    expect(await preview('short')).toEqual({ ok: false, error: 'invalid' });
    expect(await preview('A'.repeat(43))).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('claiming requires verified ownership of the invited address', () => {
  it('a different verified email cannot claim', async () => {
    const res = await createLetter(db, sender.id, { recipient: 'owner@example.com' });
    const intruder = await createUser(db, { email: 'intruder@example.com' });
    expect(await claim(intruder.id, res.token)).toMatchObject({ ok: false, error: 'email_mismatch', email_hint: 'o•••@example.com' });
    const [letter] = await db.sql(`select recipient_id from public.letters where id = $1`, [res.letter_id]);
    expect(letter.recipient_id).toBeNull();
  });

  it('an unverified account with the right address cannot claim', async () => {
    const res = await createLetter(db, sender.id, { recipient: 'unverified@example.com' });
    const user = await createUser(db, { email: 'unverified@example.com', confirmed: false, onboard: false });
    expect(await claim(user.id, res.token)).toMatchObject({ ok: false, error: 'email_mismatch' });
  });

  it('the owner claims: letter attached, recipient tree planted, sender notified', async () => {
    const res = await createLetter(db, sender.id, { recipient: 'claimer@example.com' });
    const recipient = await createUser(db, { email: 'claimer@example.com', name: 'Jun' });
    const r = await claim(recipient.id, res.token);
    expect(r).toEqual({ ok: true, letter_id: res.letter_id });

    const [letter] = await db.sql(`select recipient_id, accepted_at from public.letters where id = $1`, [res.letter_id]);
    expect(letter.recipient_id).toBe(recipient.id);
    expect(letter.accepted_at).not.toBeNull();

    const trees = await db.sql(`select role from public.trees where letter_id = $1 order by role`, [res.letter_id]);
    expect(trees.map((t) => t.role)).toEqual(['recipient', 'sender']);

    const notes = await db.asUser(sender.id, (q) => q(`select kind, body from public.notifications where letter_id = $1`, [res.letter_id]));
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe('letter_accepted');
    expect(notes[0].body).toContain('Jun');

    const mail = await db.sql(`select template from public.outbox where idempotency_key = $1`, [`accepted-email:${res.letter_id}`]);
    expect(mail).toHaveLength(1);

    // Both participants now see both trees for the letter.
    const senderView = await db.asUser(sender.id, (q) => q(`select their_tree_exists, accepted from public.mailbox($1)`, [res.letter_id]));
    expect(senderView[0]).toEqual({ their_tree_exists: true, accepted: true });
    const recipientView = await db.asUser(recipient.id, (q) => q(`select their_tree_exists, my_tree_id from public.mailbox($1)`, [res.letter_id]));
    expect(recipientView[0].their_tree_exists).toBe(true);
    expect(recipientView[0].my_tree_id).not.toBeNull();
  });

  it('claiming twice is harmless and does not notify twice; someone else cannot reuse it', async () => {
    const res = await createLetter(db, sender.id, { recipient: 'twice@example.com' });
    const recipient = await createUser(db, { email: 'twice@example.com' });
    await claim(recipient.id, res.token);
    expect(await claim(recipient.id, res.token)).toMatchObject({ ok: true });
    const notes = await db.sql(`select count(*)::int as n from public.notifications where letter_id = $1 and kind = 'letter_accepted'`, [res.letter_id]);
    expect(notes[0].n).toBe(1);
    const other = await createUser(db);
    expect(await claim(other.id, res.token)).toMatchObject({ ok: false, error: 'already_claimed' });
  });

  it('expired tokens are refused but the user can still find letters by signing up with that email', async () => {
    const res = await createLetter(db, sender.id, { recipient: 'late@example.com' });
    await db.sql(`update public.invitations set expires_at = now() - interval '1 day' where letter_id = $1`, [res.letter_id]);
    const user = await createUser(db, { email: 'late@example.com' }); // onboarding attaches by verified email
    expect(await claim(user.id, res.token)).toMatchObject({ ok: false, error: 'expired' });
    const rows = await db.asUser(user.id, (q) => q(`select letter_id, accepted from public.mailbox()`));
    expect(rows).toEqual([{ letter_id: res.letter_id, accepted: false }]);
    const [acc] = await db.asUser(user.id, (q) => q(`select public.accept_letter($1) as r`, [res.letter_id]));
    expect(acc.r).toEqual({ ok: true });
  });

  it('existing users receive letters by email directly and are notified right away', async () => {
    const existing = await createUser(db, { email: 'existing@example.com' });
    const res = await createLetter(db, sender.id, { recipient: 'existing@example.com' });
    expect(res.invited).toBe(false);
    const [letter] = await db.sql(`select recipient_id from public.letters where id = $1`, [res.letter_id]);
    expect(letter.recipient_id).toBe(existing.id);
    const notes = await db.asUser(existing.id, (q) => q(`select kind from public.notifications`));
    expect(notes.map((n) => n.kind)).toContain('letter_waiting');
    const mail = await db.sql(`select template, to_user_id from public.outbox where letter_id = $1`, [res.letter_id]);
    expect(mail).toEqual([{ template: 'letter_waiting', to_user_id: existing.id }]);
  });

  it('the sender cannot tell whether an email address has an account (no enumeration)', async () => {
    await createUser(db, { email: 'has-account@example.com' });
    const a = await createLetter(db, sender.id, { recipient: 'has-account@example.com' });
    const b = await createLetter(db, sender.id, { recipient: 'no-account@example.com' });
    const view = await db.asUser(sender.id, (q) =>
      q(`select letter_id, counterpart_name, invite_status, accepted, their_tree_exists, display_status from public.mailbox() where letter_id = any($1)`, [[a.letter_id, b.letter_id]]),
    );
    const strip = (r: Record<string, unknown>) => ({ ...r, letter_id: undefined, counterpart_name: undefined });
    expect(view).toHaveLength(2);
    expect(strip(view[0])).toEqual(strip(view[1]));
    expect(view[0].invite_status).toBe('queued');
  });

  it('letters by personal address resolve to the right person', async () => {
    const friend = await createUser(db, { name: 'Friend' });
    const res = await createLetter(db, sender.id, { recipientKind: 'handle', recipient: `@${friend.handle}` });
    const [letter] = await db.sql(`select recipient_id, recipient_label from public.letters where id = $1`, [res.letter_id]);
    expect(letter).toEqual({ recipient_id: friend.id, recipient_label: `@${friend.handle}` });
    await expect(createLetter(db, sender.id, { recipientKind: 'handle', recipient: '@does-not-exist-99' })).rejects.toThrow(/recipient_not_found/);
  });

  it('a letter to your future self needs no acceptance and grows one tree', async () => {
    const res = await createLetter(db, sender.id, { recipient: sender.email });
    const rows = await db.asUser(sender.id, (q) => q(`select direction, accepted, their_tree_exists from public.mailbox($1)`, [res.letter_id]));
    expect(rows).toEqual([{ direction: 'self', accepted: true, their_tree_exists: false }]);
  });
});
