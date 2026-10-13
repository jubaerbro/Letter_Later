/**
 * Demo letters for the Google Play review account (see scripts/seed-reviewer.mjs).
 * Both are letters to the reviewer's future self:
 *   1. one that arrived two days ago — so the opening ceremony can be reviewed immediately;
 *   2. one that opens in a year — so trees, care and the countdown can be reviewed.
 * Fixed idempotency keys make re-running the seeder harmless.
 */
import { seal, type KeyRing } from '../crypto.ts';

const CONTENT_AAD = (idempotencyKey: string) => `letter-content:v1:${idempotencyKey}`;

interface DemoLetter {
  key: string;
  subject: string;
  body: string;
  plantedDaysAgo: number;
  opensAfterHours: number; // relative to planting
}

const LETTERS: DemoLetter[] = [
  {
    key: 'reviewer-welcome-v1',
    subject: 'Welcome to LaterLetter',
    body:
      'Hello, and thank you for reviewing LaterLetter.\n\n' +
      'This letter was sealed a few days ago and became readable on the date chosen when it was written. ' +
      'Senders choose who it is for, when it opens, and what the recipient can see before then. ' +
      'Once sent, a letter cannot be edited, rescheduled or opened early.\n\n' +
      'While a letter waits, the sender and the recipient each grow a tree. Caring for it is optional and only changes how the tree looks — never when the letter opens.\n\n' +
      'You can report a letter or block a sender from any received letter, and delete the account from You → Delete account.\n\n' +
      'Warmly,\nthe LaterLetter team',
    plantedDaysAgo: 3,
    opensAfterHours: 2,
  },
  {
    key: 'reviewer-next-year-v1',
    subject: 'For next year',
    body: 'A letter to the future. Its tree is growing in the garden while it waits.',
    plantedDaysAgo: 7,
    opensAfterHours: 24 * 372,
  },
];

export async function reviewerLetterArgs(ring: KeyRing, input: { userId: string; email: string; timeZone: string; now: Date }) {
  const args: Record<string, unknown>[] = [];
  for (const l of LETTERS) {
    const planted = new Date(input.now.getTime() - l.plantedDaysAgo * 86_400_000);
    const sealed = await seal(ring, JSON.stringify({ subject: l.subject, body: l.body }), CONTENT_AAD(l.key));
    args.push({
      p_sender_id: input.userId,
      p_idempotency_key: l.key,
      p_recipient_kind: 'email',
      p_recipient_value: input.email,
      p_reveal_mode: 'name_subject_date',
      p_show_subject: true,
      p_show_preview: false,
      p_envelope_subject: l.subject,
      p_envelope_preview: null,
      p_sender_time_zone: input.timeZone,
      p_deliver_at: new Date(planted.getTime() + l.opensAfterHours * 3_600_000).toISOString(),
      p_ciphertext: sealed.ciphertext,
      p_iv: sealed.iv,
      p_key_version: sealed.keyVersion,
      p_invite_token_hash: null,
      p_invite_token_enc: null,
      p_now: planted.toISOString(),
    });
  }
  return args;
}
