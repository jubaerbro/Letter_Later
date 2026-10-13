import { newToken, open, seal, type KeyRing } from '../crypto.ts';
import { revealProblems, type RevealMode } from '../domain/reveal.ts';
import { isValidTimeZone, validateDeliveryInstant } from '../domain/time.ts';
import { cleanText, draftProblems, LIMITS, parseRecipient } from '../domain/validation.ts';
import { DbError, type Db } from './db.ts';
import { processOutbox, sealToken, type MessagingDeps } from './outbox.ts';

export class RequestError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}

export interface CreateLetterRequest {
  idempotencyKey: string;
  recipient: string;
  subject: string;
  body: string;
  revealMode: RevealMode;
  showSubject?: boolean;
  showPreview?: boolean;
  preview?: string;
  deliverAt: string; // ISO-8601 UTC instant computed by the client from wall time + zone
  timeZone: string;
}

const REVEAL_MODES: RevealMode[] = ['name_and_date', 'name_subject_date', 'name_and_preview', 'anonymous'];
const CONTENT_AAD = (idempotencyKey: string) => `letter-content:v1:${idempotencyKey}`;

export function parseCreateLetter(input: unknown): CreateLetterRequest {
  const b = (input ?? {}) as Record<string, unknown>;
  const str = (k: string, max: number, required = true) => {
    const v = b[k];
    if (v === undefined || v === null || v === '') {
      if (required) throw new RequestError(`${k}_required`);
      return '';
    }
    if (typeof v !== 'string' || v.length > max) throw new RequestError(`${k}_invalid`);
    return v;
  };
  const revealMode = b.revealMode as RevealMode;
  if (!REVEAL_MODES.includes(revealMode)) throw new RequestError('revealMode_invalid');
  const idempotencyKey = str('idempotencyKey', 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey)) throw new RequestError('idempotencyKey_invalid');
  return {
    idempotencyKey,
    recipient: str('recipient', LIMITS.email + 1),
    subject: cleanText(str('subject', LIMITS.subject, false)),
    body: cleanText(str('body', LIMITS.body)),
    revealMode,
    showSubject: b.showSubject === true,
    showPreview: b.showPreview === true,
    preview: cleanText(str('preview', LIMITS.preview, false)),
    deliverAt: str('deliverAt', 40),
    timeZone: str('timeZone', 64),
  };
}

export async function createLetter(deps: MessagingDeps, senderId: string, req: CreateLetterRequest) {
  const recipient = parseRecipient(req.recipient);
  if ('error' in recipient) throw new RequestError(recipient.error);
  const problems = [
    ...draftProblems({ subject: req.subject, body: req.body }),
    ...revealProblems({
      choice: { mode: req.revealMode, showSubject: req.showSubject, showPreview: req.showPreview },
      senderName: '',
      subject: req.subject,
      preview: req.preview,
    }),
  ];
  if (problems.length) throw new RequestError(problems[0]);
  if (!isValidTimeZone(req.timeZone)) throw new RequestError('time_zone_invalid');

  const deliverAt = new Date(req.deliverAt);
  const scheduleProblem = validateDeliveryInstant(deliverAt, deps.now(), {
    minLeadSeconds: await deps.db.configInt('min_delivery_lead_seconds'),
    maxYears: await deps.db.configInt('max_delivery_years'),
  });
  if (scheduleProblem === 'invalid') throw new RequestError('invalid_wall_time');
  if (scheduleProblem === 'too_soon') throw new RequestError('deliver_at_too_soon');
  if (scheduleProblem === 'too_far') throw new RequestError('deliver_at_too_far');

  const sealed = await seal(deps.ring, JSON.stringify({ subject: req.subject.trim(), body: req.body }), CONTENT_AAD(req.idempotencyKey));
  const token = await newToken();

  let result: { ok: boolean; letter_id: string; duplicate: boolean; invited?: boolean; is_self?: boolean };
  try {
    result = await deps.db.rpc('create_letter_record', {
      p_sender_id: senderId,
      p_idempotency_key: req.idempotencyKey,
      p_recipient_kind: recipient.kind,
      p_recipient_value: recipient.value,
      p_reveal_mode: req.revealMode,
      p_show_subject: req.showSubject ?? false,
      p_show_preview: req.showPreview ?? false,
      p_envelope_subject: req.subject.trim() || null,
      p_envelope_preview: req.preview?.trim() || null,
      p_sender_time_zone: req.timeZone,
      p_deliver_at: deliverAt.toISOString(),
      p_ciphertext: sealed.ciphertext,
      p_iv: sealed.iv,
      p_key_version: sealed.keyVersion,
      p_invite_token_hash: token.hash,
      p_invite_token_enc: await sealToken(deps.ring, token.token),
      p_now: deps.now().toISOString(),
    });
  } catch (error) {
    if (error instanceof DbError && error.code === 'P0001') throw new RequestError(error.message);
    throw error;
  }

  // Send the invitation / "a seed has arrived" email right away rather than waiting for
  // the next scheduler tick. If the provider is down, the outbox retries automatically.
  if (!result.duplicate) {
    await processOutbox(deps, `create-${result.letter_id}`, { letterId: result.letter_id, limit: 5 }).catch((e) =>
      deps.log('immediate_send_failed', { letter_id: result.letter_id, error: (e as Error).message }),
    );
  }
  // Deliberately uniform: the response never reveals whether the recipient already has an
  // account (that would let anyone test which email addresses are registered).
  const notificationEmail = await deps.db.rpc<string | null>('recipient_email_status', { p_letter_id: result.letter_id });
  return {
    letterId: result.letter_id,
    duplicate: result.duplicate,
    isSelf: !!result.is_self,
    notificationEmail,
  };
}

export async function readLetterContent(
  deps: { db: Db; ring: KeyRing; now: () => Date },
  userId: string,
  letterId: string,
  markOpened: boolean,
) {
  const access = await deps.db.rpc<{
    ok: boolean;
    error?: string;
    role?: 'sender' | 'recipient';
    ciphertext?: string;
    iv?: string;
    key_version?: number;
    first_open?: boolean;
    idempotency_key?: string;
  }>('letter_content_access', { p_user_id: userId, p_letter_id: letterId, p_now: deps.now().toISOString() });
  if (!access.ok) throw new RequestError(access.error ?? 'not_found', 404);

  const plaintext = await open(
    deps.ring,
    { ciphertext: access.ciphertext!, iv: access.iv!, keyVersion: access.key_version! },
    CONTENT_AAD(access.idempotency_key!),
  );
  const content = JSON.parse(plaintext) as { subject: string; body: string };

  let openedNow = false;
  if (access.role === 'recipient' && access.first_open && markOpened) {
    openedNow = await deps.db.rpc<boolean>('mark_letter_opened', { p_user_id: userId, p_letter_id: letterId, p_now: deps.now().toISOString() });
  }
  return { role: access.role!, subject: content.subject, body: content.body, openedNow };
}
