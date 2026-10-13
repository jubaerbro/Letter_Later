/** Expo push notifications (FCM on Android behind the scenes). */

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export type PushResult = { ok: true; invalidTokens: string[] } | { ok: false; permanent: boolean; error: string };

export interface PushSender {
  readonly isMock: boolean;
  send(tokens: string[], message: PushMessage): Promise<PushResult>;
}

export class ExpoPushSender implements PushSender {
  readonly isMock = false;
  constructor(
    private readonly accessToken?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(tokens: string[], message: PushMessage): Promise<PushResult> {
    if (tokens.length === 0) return { ok: true, invalidTokens: [] };
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    let res: Response;
    try {
      res = await this.fetchImpl('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(
          tokens.map((to) => ({ to, title: message.title, body: message.body, data: message.data, sound: 'default', channelId: 'letters' })),
        ),
      });
    } catch (error) {
      return { ok: false, permanent: false, error: `network: ${(error as Error).message}`.slice(0, 300) };
    }
    if (!res.ok) {
      return { ok: false, permanent: res.status >= 400 && res.status < 500 && res.status !== 429, error: `expo ${res.status}` };
    }
    const body = (await res.json().catch(() => ({}))) as {
      data?: Array<{ status: string; details?: { error?: string } }>;
    };
    const invalidTokens = (body.data ?? [])
      .map((ticket, i) => (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered' ? tokens[i] : null))
      .filter((t): t is string => !!t);
    return { ok: true, invalidTokens };
  }
}

/** MOCK push sender: records messages, sends nothing. */
export class MockPushSender implements PushSender {
  readonly isMock = true;
  readonly sent: Array<{ tokens: string[]; message: PushMessage }> = [];
  async send(tokens: string[], message: PushMessage): Promise<PushResult> {
    this.sent.push({ tokens, message });
    return { ok: true, invalidTokens: [] };
  }
}
