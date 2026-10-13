// Deno-only helpers for Edge Functions. Not imported by the app or by tests.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { loadKeyRing } from './crypto.ts';
import { checkServerEnv, formatIssues } from './env.ts';
import { emailProviderFromEnv } from './email/provider.ts';
import { ExpoPushSender, MockPushSender } from './push.ts';
import { DbError, type Db, type LetterEmailRow } from './services/db.ts';
import type { MessagingDeps } from './services/outbox.ts';

export function env(key: string): string | undefined {
  return Deno.env.get(key) ?? undefined;
}

export function requireEnv(key: string): string {
  const v = env(key);
  if (!v) throw new Error(`Missing required secret ${key}`);
  return v;
}

let admin: SupabaseClient | null = null;
/** Service-role client. Lives only inside Edge Functions; never shipped to the app. */
export function serviceClient(): SupabaseClient {
  admin ??= createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export class SupabaseDb implements Db {
  constructor(private readonly client: SupabaseClient) {}

  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw new DbError(error.message, error.code ?? null);
    return data as T;
  }

  async rpcRows<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw new DbError(error.message, error.code ?? null);
    return (data ?? []) as T[];
  }

  async letterEmailContext(letterId: string): Promise<LetterEmailRow | null> {
    const { data, error } = await this.client
      .from('letters')
      .select('envelope_sender_name, envelope_sender_handle, deliver_at, sender_time_zone, recipient_id')
      .eq('id', letterId)
      .maybeSingle();
    if (error) throw new DbError(error.message, error.code ?? null);
    if (!data) return null;
    let recipientName: string | null = null;
    if (data.recipient_id) {
      const { data: p } = await this.client.from('profiles').select('display_name').eq('id', data.recipient_id).maybeSingle();
      recipientName = p?.display_name ?? null;
    }
    return { ...data, recipient_name: recipientName } as LetterEmailRow;
  }

  async configInt(key: string): Promise<number> {
    return Number(await this.rpc('config_int', { p_key: key }));
  }
}

/** Structured logs with ids only — never letter content, never full email addresses. */
export function log(event: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ...detail, at: new Date().toISOString() }));
}

export const isProduction = () => env('APP_ENV') === 'production';

let configChecked = false;
/** In production, refuse to run with unsafe or incomplete configuration (logs key names only). */
export function assertConfig() {
  if (configChecked) return;
  const errors = checkServerEnv(env, { production: isProduction() }).filter((i) => i.severity === 'error');
  if (errors.length && isProduction()) {
    console.error(formatIssues('Edge Function configuration', errors));
    throw new Error('Server is misconfigured; see function logs.');
  }
  configChecked = true;
}

export async function messagingDeps(): Promise<MessagingDeps> {
  assertConfig();
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const expoToken = env('EXPO_ACCESS_TOKEN');
  return {
    db: new SupabaseDb(serviceClient()),
    email: emailProviderFromEnv(env),
    push: env('PUSH_PROVIDER') === 'mock' && !isProduction() ? new MockPushSender() : new ExpoPushSender(expoToken),
    ring: await loadKeyRing(env('LETTER_ENCRYPTION_KEYS')),
    urls: { web: requireEnv('WEB_BASE_URL').replace(/\/$/, ''), functions: `${supabaseUrl}/functions/v1` },
    optOutSecret: requireEnv('EMAIL_OPTOUT_SECRET'),
    now: () => new Date(),
    log,
  };
}

/** Verifies the caller's access token with Supabase Auth and returns their user id. */
export async function requireUser(req: Request): Promise<{ id: string; email: string | null }> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'not_authenticated');
  const { data, error } = await serviceClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'not_authenticated');
  return { id: data.user.id, email: data.user.email ?? null };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** Wraps a handler with CORS, method checks and safe error responses. */
export function serve(methods: string[], handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (!methods.includes(req.method)) return json({ error: 'method_not_allowed' }, 405);
    try {
      return await handler(req);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code }, error.status);
      const code = (error as { code?: string }).code;
      if (typeof code === 'string' && /^[a-z_]+$/.test(code)) return json({ error: code }, (error as { status?: number }).status ?? 400);
      log('unhandled_error', { message: (error as Error).message?.slice(0, 200) });
      return json({ error: 'unknown' }, 500);
    }
  });
}
