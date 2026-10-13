/**
 * Transactional email behind a tiny interface so the provider can be swapped.
 *
 * IMPORTANT: a successful send() means the provider *accepted* the message
 * (outbox status `provider_accepted`). It does not prove inbox delivery or that anyone
 * read it.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-level idempotency so retries never send twice. */
  idempotencyKey: string;
  headers?: Record<string, string>;
}

export type SendResult = { ok: true; id: string } | { ok: false; permanent: boolean; error: string };

export interface EmailProvider {
  readonly name: string;
  readonly isMock: boolean;
  send(message: EmailMessage): Promise<SendResult>;
}

export class ResendProvider implements EmailProvider {
  readonly name = 'resend';
  readonly isMock = false;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    let res: Response;
    try {
      res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers,
        }),
      });
    } catch (error) {
      return { ok: false, permanent: false, error: `network: ${(error as Error).message}`.slice(0, 300) };
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: body.id ?? 'unknown' };
    }
    // 429 and 5xx are worth retrying; other 4xx (bad address, unverified domain) are not.
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 409;
    const detail = await res.text().catch(() => '');
    return { ok: false, permanent, error: `resend ${res.status}: ${detail}`.slice(0, 300) };
  }
}

/**
 * MOCK provider for local development and tests. It does NOT send email. It records the
 * message in memory and logs a masked summary. Set MOCK_EMAIL_LOG_LINKS=true only on your
 * own machine if you want claim links printed to the function logs.
 */
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';
  readonly isMock = true;
  readonly sent: EmailMessage[] = [];
  constructor(
    private readonly logLinks = false,
    private readonly failWith: SendResult | null = null,
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    if (this.failWith) return this.failWith;
    if (this.sent.some((m) => m.idempotencyKey === message.idempotencyKey)) {
      return { ok: true, id: `mock-dedup-${message.idempotencyKey}` };
    }
    this.sent.push(message);
    const masked = message.to.replace(/^(.).*@/, '$1•••@');
    console.log(`[MOCK EMAIL — not sent] to=${masked} subject="${message.subject}"`);
    if (this.logLinks) {
      const links = message.text.match(/https?:\/\/\S+/g) ?? [];
      console.log(`[MOCK EMAIL] links: ${links.join(' ')}`);
    }
    return { ok: true, id: `mock-${this.sent.length}` };
  }
}

export function emailProviderFromEnv(env: (key: string) => string | undefined): EmailProvider {
  const provider = (env('EMAIL_PROVIDER') ?? 'mock').toLowerCase();
  const production = env('APP_ENV') === 'production';
  if (production && provider !== 'resend') {
    // Never silently "send" mock email to real users.
    throw new Error('APP_ENV=production requires EMAIL_PROVIDER=resend');
  }
  if (provider === 'resend') {
    const key = env('RESEND_API_KEY');
    const from = env('EMAIL_FROM');
    if (!key || !from) throw new Error('EMAIL_PROVIDER=resend requires RESEND_API_KEY and EMAIL_FROM');
    return new ResendProvider(key, from);
  }
  return new MockEmailProvider(!production && env('MOCK_EMAIL_LOG_LINKS') === 'true');
}
