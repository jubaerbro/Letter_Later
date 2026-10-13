import { open, seal, signValue, type KeyRing } from '../crypto.ts';
import type { EmailProvider } from '../email/provider.ts';
import { renderEmail, type EmailTemplate } from '../email/templates.ts';
import type { PushSender } from '../push.ts';
import type { Db } from './db.ts';

export interface Urls {
  /** Public web origin that hosts the claim/open pages and Android App Links, e.g. https://laterletter.app */
  web: string;
  /** Base URL of Edge Functions, e.g. https://<ref>.supabase.co/functions/v1 */
  functions: string;
}

export interface MessagingDeps {
  db: Db;
  email: EmailProvider;
  push: PushSender;
  ring: KeyRing;
  urls: Urls;
  optOutSecret: string;
  now: () => Date;
  log: (event: string, detail?: Record<string, unknown>) => void;
}

interface OutboxJob {
  id: string;
  channel: 'email' | 'push';
  template: string;
  to_email: string | null;
  to_user_id: string | null;
  letter_id: string | null;
  params: Record<string, unknown>;
  attempts: number;
  push_tokens: string[] | null;
}

const TOKEN_AAD = 'invitation-token:v1';

/** Invitation tokens are kept encrypted in the outbox so retries can resend the same link. */
export async function sealToken(ring: KeyRing, token: string): Promise<string> {
  const s = await seal(ring, token, TOKEN_AAD);
  return `${s.keyVersion}.${s.iv}.${s.ciphertext}`;
}

export async function openToken(ring: KeyRing, sealed: string): Promise<string> {
  const [v, iv, ciphertext] = sealed.split('.');
  return open(ring, { keyVersion: Number(v), iv, ciphertext }, TOKEN_AAD);
}

export function claimUrl(urls: Urls, token: string) {
  return `${urls.web}/claim?token=${encodeURIComponent(token)}`;
}

export function letterUrl(urls: Urls, letterId: string) {
  return `${urls.web}/letter/${letterId}`;
}

async function optOutUrl(deps: MessagingDeps, email: string) {
  return `${deps.urls.functions}/email-optout?t=${encodeURIComponent(await signValue(deps.optOutSecret, `optout:${email}`))}`;
}

export interface OutboxSummary {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}

/** Sends queued emails/pushes. Safe to run concurrently and repeatedly. */
export async function processOutbox(
  deps: MessagingDeps,
  workerId: string,
  opts: { limit?: number; letterId?: string | null } = {},
): Promise<OutboxSummary> {
  const summary: OutboxSummary = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };
  // Immediate sends for one letter use the database clock (null), so app-server clock skew
  // can never make a just-queued message look "not yet due".
  const nowArg = () => (opts.letterId ? null : deps.now().toISOString());
  const jobs = await deps.db.rpcRows<OutboxJob>('claim_outbox', {
    p_worker: workerId,
    p_limit: opts.limit ?? 50,
    p_now: nowArg(),
    p_letter_id: opts.letterId ?? null,
  });
  summary.claimed = jobs.length;

  for (const job of jobs) {
    try {
      const outcome = job.channel === 'email' ? await sendEmailJob(deps, job) : await sendPushJob(deps, job);
      if (outcome.kind === 'sent') {
        await deps.db.rpc('complete_outbox', { p_id: job.id, p_worker: workerId, p_provider_message_id: outcome.id, p_now: nowArg() });
        summary.sent++;
      } else if (outcome.kind === 'skip') {
        await deps.db.rpc('skip_outbox', { p_id: job.id, p_worker: workerId, p_reason: outcome.reason });
        summary.skipped++;
      } else {
        const r = await deps.db.rpc<string>('fail_outbox', {
          p_id: job.id,
          p_worker: workerId,
          p_error: outcome.error,
          p_permanent: outcome.permanent,
          p_now: nowArg(),
        });
        if (r === 'failed') summary.failed++;
        else summary.retried++;
      }
      deps.log('outbox_job', { id: job.id, channel: job.channel, template: job.template, outcome: outcome.kind });
    } catch (error) {
      // Unexpected bug: record it on the job (no content) and let backoff handle it.
      await deps.db
        .rpc('fail_outbox', { p_id: job.id, p_worker: workerId, p_error: `internal: ${(error as Error).message}`, p_permanent: false, p_now: nowArg() })
        .catch(() => {});
      summary.retried++;
      deps.log('outbox_job_error', { id: job.id, error: (error as Error).message });
    }
  }
  return summary;
}

type Outcome = { kind: 'sent'; id: string } | { kind: 'skip'; reason: string } | { kind: 'fail'; error: string; permanent: boolean };

async function sendEmailJob(deps: MessagingDeps, job: OutboxJob): Promise<Outcome> {
  if (!job.to_email) return { kind: 'skip', reason: 'no_verified_address' };
  if (!job.letter_id) return { kind: 'skip', reason: 'no_letter' };
  const row = await deps.db.letterEmailContext(job.letter_id);
  if (!row) return { kind: 'skip', reason: 'letter_gone' };

  const template = job.template as EmailTemplate;
  const tokenEnc = typeof job.params.token_enc === 'string' ? job.params.token_enc : null;
  const unregistered = !job.to_user_id;
  let actionUrl = letterUrl(deps.urls, job.letter_id);
  if (tokenEnc) actionUrl = claimUrl(deps.urls, await openToken(deps.ring, tokenEnc));
  const optOut = unregistered ? await optOutUrl(deps, job.to_email) : undefined;

  const rendered = renderEmail(
    template,
    {
      senderName: row.envelope_sender_name,
      senderHandle: row.envelope_sender_handle,
      recipientName: (job.params.recipient_name as string | undefined) ?? row.recipient_name,
      deliverAt: new Date(row.deliver_at),
      timeZone: row.sender_time_zone,
    },
    { actionUrl, optOutUrl: optOut },
  );

  const headers: Record<string, string> = {};
  if (optOut) {
    headers['List-Unsubscribe'] = `<${optOut}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const result = await deps.email.send({
    to: job.to_email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: `outbox-${job.id}`,
    headers,
  });
  return result.ok ? { kind: 'sent', id: result.id } : { kind: 'fail', error: result.error, permanent: result.permanent };
}

async function sendPushJob(deps: MessagingDeps, job: OutboxJob): Promise<Outcome> {
  const tokens = job.push_tokens ?? [];
  if (tokens.length === 0) return { kind: 'skip', reason: 'no_push_tokens' };
  const result = await deps.push.send(tokens, {
    title: String(job.params.title ?? 'LaterLetter'),
    body: String(job.params.body ?? ''),
    data: { letterId: job.letter_id, kind: job.template },
  });
  if (!result.ok) return { kind: 'fail', error: result.error, permanent: result.permanent };
  if (result.invalidTokens.length) await deps.db.rpc('remove_push_tokens', { p_tokens: result.invalidTokens });
  return { kind: 'sent', id: `expo-${tokens.length}` };
}
