/**
 * Phase 2 vertical slice, server side, using the real service code and real Postgres:
 *   sign-up → letter to an unregistered email → invitation email (mock provider) →
 *   recipient signs up with that email and claims via the emailed link → sealed letter
 *   and countdown → accelerated test clock → delivery → arrival email → opening.
 *
 * The email provider and push sender are MOCKS (no network). Everything else — SQL,
 * authorization, encryption, scheduling, outbox — is the production code path.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadKeyRing, toBase64 } from '@shared/crypto';
import { MockEmailProvider } from '@shared/email/provider';
import { MockPushSender } from '@shared/push';
import { runDeliveryCycle } from '@shared/services/delivery';
import { createLetter, readLetterContent, RequestError } from '@shared/services/letters';
import type { MessagingDeps } from '@shared/services/outbox';
import { createUser, openDb, type TestDb } from './helpers';
import { PgDb } from './pg-db';

let db: TestDb;
let deps: MessagingDeps;
let email: MockEmailProvider;
let push: MockPushSender;
let clock = new Date();

beforeAll(async () => {
  db = await openDb();
  email = new MockEmailProvider();
  push = new MockPushSender();
  deps = {
    db: new PgDb(await db.newClient()),
    email,
    push,
    ring: await loadKeyRing(`1:${toBase64(crypto.getRandomValues(new Uint8Array(32)))}`),
    urls: { web: 'https://letterlater.test', functions: 'https://ref.supabase.test/functions/v1' },
    optOutSecret: 'test-optout-secret',
    now: () => clock,
    log: () => {},
  };
});
afterAll(async () => db?.close());

describe('vertical slice', () => {
  let sender: Awaited<ReturnType<typeof createUser>>;
  let letterId: string;
  let claimToken: string;
  const deliverAt = new Date(Date.now() + 3 * 3600_000);

  it('1–2. a registered sender writes a letter to someone without an account', async () => {
    sender = await createUser(db, { name: 'Maya', email: 'maya@example.com' });
    const result = await createLetter(deps, sender.id, {
      idempotencyKey: 'slice-letter-0001',
      recipient: 'jun@example.com',
      subject: 'For the day you graduate',
      body: 'Dear Jun,\nI am so proud of you.\n— Maya',
      revealMode: 'name_and_date',
      deliverAt: deliverAt.toISOString(),
      timeZone: 'Europe/London',
    });
    letterId = result.letterId;
    expect(result).toMatchObject({ duplicate: false, invited: true, invitationEmail: 'provider_accepted' });
  });

  it('3. the content is stored encrypted — the database never sees the words', async () => {
    const [row] = await db.sql(`select ciphertext from public.letter_contents where letter_id = $1`, [letterId]);
    expect(row.ciphertext).not.toContain('proud');
    const [audit] = await db.sql(`select string_agg(detail::text, ' ') as d from public.delivery_events where letter_id = $1`, [letterId]);
    expect(audit.d ?? '').not.toContain('proud');
  });

  it('4–5. the invitation email was sent immediately, without the letter content', async () => {
    expect(email.sent).toHaveLength(1);
    const invite = email.sent[0];
    expect(invite.to).toBe('jun@example.com');
    expect(invite.subject).toBe('Maya planted a letter for you');
    expect(invite.text).not.toContain('proud');
    expect(invite.text).not.toContain('graduate');
    expect(invite.headers?.['List-Unsubscribe']).toMatch(/email-optout/);
    const link = invite.text.match(/https:\/\/letterlater\.test\/claim\?token=([A-Za-z0-9_-]{43})/);
    expect(link).not.toBeNull();
    claimToken = link![1];
  });

  it('retrying the request never creates a second letter or a second email', async () => {
    const again = await createLetter(deps, sender.id, {
      idempotencyKey: 'slice-letter-0001',
      recipient: 'jun@example.com',
      subject: 'For the day you graduate',
      body: 'Dear Jun,\nI am so proud of you.\n— Maya',
      revealMode: 'name_and_date',
      deliverAt: deliverAt.toISOString(),
      timeZone: 'Europe/London',
    });
    expect(again).toMatchObject({ letterId, duplicate: true });
    expect(email.sent).toHaveLength(1);
  });

  it('6. the recipient verifies their email (sign-up) and claims the mailbox from the link', async () => {
    const preview = await db.asAnon((q) => q(`select public.invitation_preview($1) as r`, [claimToken]));
    expect(preview[0].r).toMatchObject({ ok: true, sender_name: 'Maya', email_hint: 'j•••@example.com', arrived: false });

    const jun = await createUser(db, { name: 'Jun', email: 'jun@example.com' });
    const [claim] = await db.asUser(jun.id, (q) => q(`select public.claim_invitation($1) as r`, [claimToken]));
    expect(claim.r).toEqual({ ok: true, letter_id: letterId });

    // Sender is told, in-app (and an email is queued).
    const notes = await db.asUser(sender.id, (q) => q(`select kind from public.notifications`));
    expect(notes.map((n) => n.kind)).toContain('letter_accepted');
  });

  it('7. the recipient sees a sealed letter with its countdown; content stays locked', async () => {
    const [jun] = await db.sql(`select id from auth.users where email = 'jun@example.com'`);
    const rows = await db.asUser(jun.id, (q) => q(`select * from public.mailbox()`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'received', counterpart_name: 'Maya', display_status: 'waiting', subject: null });
    expect(new Date(rows[0].deliver_at).toISOString()).toBe(deliverAt.toISOString());
    await expect(readLetterContent(deps, jun.id, letterId, true)).rejects.toBeInstanceOf(RequestError);

    // The sender can re-read what they wrote, but can never change it.
    const mine = await readLetterContent(deps, sender.id, letterId, true);
    expect(mine).toMatchObject({ role: 'sender', subject: 'For the day you graduate', openedNow: false });
  });

  it('8. with an accelerated test clock, the scheduler delivers exactly once', async () => {
    const before = await runDeliveryCycle(deps, { workerId: 'tick-1' });
    expect(before.delivered).toBe(0);

    clock = new Date(deliverAt.getTime() + 60_000);
    const tick = await runDeliveryCycle(deps, { workerId: 'tick-2' });
    expect(tick.delivered).toBe(1);
    expect(tick.outbox.sent).toBeGreaterThanOrEqual(2); // accepted-email to Maya + arrival email to Jun

    const again = await runDeliveryCycle(deps, { workerId: 'tick-3' });
    expect(again.delivered).toBe(0);

    const arrival = email.sent.filter((m) => m.subject.startsWith('Your letter has arrived'));
    expect(arrival).toHaveLength(1);
    expect(arrival[0].to).toBe('jun@example.com');
    expect(arrival[0].text).not.toContain('proud');
  });

  it('…and the recipient opens it; the sender sees it was opened', async () => {
    // The recipient-side time check uses the real clock in SQL, so move the row's instant
    // into the past the same way the accelerated clock did (test-only superuser edit).
    await db.sql(`alter table public.letters disable trigger letters_guard`);
    await db.sql(`update public.letters set deliver_at = now() - interval '1 minute', created_at = now() - interval '1 day' where id = $1`, [letterId]);
    await db.sql(`alter table public.letters enable trigger letters_guard`);
    clock = new Date();

    const [jun] = await db.sql(`select id from auth.users where email = 'jun@example.com'`);
    const opened = await readLetterContent(deps, jun.id, letterId, true);
    expect(opened).toEqual({ role: 'recipient', subject: 'For the day you graduate', body: 'Dear Jun,\nI am so proud of you.\n— Maya', openedNow: true });
    const second = await readLetterContent(deps, jun.id, letterId, true);
    expect(second.openedNow).toBe(false);

    const [view] = await db.asUser(sender.id, (q) => q(`select display_status from public.mailbox($1)`, [letterId]));
    expect(view.display_status).toBe('opened');
    const events = await db.sql(`select event from public.delivery_events where letter_id = $1 order by id`, [letterId]);
    expect(events.map((e) => e.event)).toEqual([
      'created',
      'invitation_queued',
      'invitation_email_provider_accepted',
      'recipient_attached',
      'accepted',
      'invitation_claimed',
      'due',
      'delivered',
      'letter_accepted_email_provider_accepted',
      'letter_arrived_email_provider_accepted',
      'opened',
    ]);
  });

  it('an email provider outage is retried later, without duplicates', async () => {
    const down = new MockEmailProvider(false, { ok: false, permanent: false, error: 'resend 503' });
    const outageDeps = { ...deps, email: down };
    const res = await createLetter(outageDeps, sender.id, {
      idempotencyKey: 'slice-outage-0001',
      recipient: 'later@example.com',
      subject: '',
      body: 'Hello',
      revealMode: 'anonymous',
      deliverAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
      timeZone: 'UTC',
    });
    expect(res.invitationEmail).toBe('queued');

    clock = new Date(Date.now() + 2 * 60_000); // after the 1-minute backoff
    const tick = await runDeliveryCycle(deps, { workerId: 'retry' });
    expect(tick.outbox.sent).toBe(1);
    const sent = email.sent.filter((m) => m.to === 'later@example.com');
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('A letter is waiting for you'); // anonymous
  });
});
