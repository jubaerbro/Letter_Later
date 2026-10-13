import { randomBytes, randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';

export type Query = <R extends pg.QueryResultRow = any>(sql: string, params?: unknown[]) => Promise<R[]>;

export interface TestDb {
  /** Superuser connection (like the SQL editor). */
  sql: Query;
  /** Runs fn as an authenticated user, exactly as PostgREST would. */
  asUser<T>(userId: string, fn: (q: Query) => Promise<T>): Promise<T>;
  asAnon<T>(fn: (q: Query) => Promise<T>): Promise<T>;
  /** Runs fn as service_role (what Edge Functions use). */
  asService<T>(fn: (q: Query) => Promise<T>): Promise<T>;
  newClient(): Promise<pg.Client>;
  close(): Promise<void>;
}

export async function openDb(): Promise<TestDb> {
  const port = inject('pgPort');
  const name = `t_${randomUUID().replaceAll('-', '')}`;
  const base = { host: 'localhost', port, user: 'postgres', password: 'postgres' };

  const admin = new pg.Client({ ...base, database: 'postgres' });
  await admin.connect();
  await admin.query(`create database ${name} template template_ll`);
  await admin.end();

  const clients: pg.Client[] = [];
  const newClient = async () => {
    const c = new pg.Client({ ...base, database: name });
    await c.connect();
    clients.push(c);
    return c;
  };
  const main = await newClient();
  const q =
    (c: pg.Client): Query =>
    async (text, params) =>
      (await c.query(text, params as any[])).rows;

  const withRole = async <T>(role: string, claims: object | null, fn: (q: Query) => Promise<T>) => {
    await main.query('begin');
    try {
      if (claims) await main.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await main.query(`set local role ${role}`);
      const result = await fn(q(main));
      await main.query('commit');
      return result;
    } catch (error) {
      await main.query('rollback');
      throw error;
    }
  };

  return {
    sql: q(main),
    asUser: (userId, fn) => withRole('authenticated', { sub: userId, role: 'authenticated' }, fn),
    asAnon: (fn) => withRole('anon', { role: 'anon' }, fn),
    asService: (fn) => withRole('service_role', { role: 'service_role' }, fn),
    newClient,
    close: async () => {
      await Promise.all(clients.map((c) => c.end().catch(() => {})));
      const a = new pg.Client({ ...base, database: 'postgres' });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export async function createUser(
  db: TestDb,
  opts: { email?: string; name?: string; onboard?: boolean; confirmed?: boolean; timeZone?: string } = {},
) {
  const email = opts.email ?? `${randomUUID().slice(0, 8)}@example.com`;
  const [user] = await db.sql<{ id: string }>(
    `insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id`,
    [email, opts.confirmed === false ? null : new Date()],
  );
  if (opts.onboard !== false) {
    const [res] = await db.asUser(user.id, (q) =>
      q(`select public.complete_onboarding($1, $2, 'north', true, true) as r`, [
        opts.name ?? 'Test Person',
        opts.timeZone ?? 'Europe/London',
      ]),
    );
    if (!res.r.ok) throw new Error(`onboarding failed: ${JSON.stringify(res.r)}`);
  }
  const [profile] = await db.sql(`select handle from public.profiles where id = $1`, [user.id]);
  return { id: user.id, email, handle: profile.handle as string };
}

export function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}

export interface LetterInput {
  recipientKind?: 'email' | 'handle';
  recipient: string;
  revealMode?: 'name_and_date' | 'name_subject_date' | 'name_and_preview' | 'anonymous';
  showSubject?: boolean;
  showPreview?: boolean;
  subject?: string | null;
  preview?: string | null;
  deliverAt?: Date;
  idempotencyKey?: string;
  now?: Date;
}

export async function createLetter(db: TestDb, senderId: string, input: LetterInput) {
  const tok = newToken();
  const [row] = await db.asService((q) =>
    q(
      `select public.create_letter_record($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) as r`,
      [
        senderId,
        input.idempotencyKey ?? randomUUID(),
        input.recipientKind ?? 'email',
        input.recipient,
        input.revealMode ?? 'name_and_date',
        input.showSubject ?? false,
        input.showPreview ?? false,
        input.subject ?? null,
        input.preview ?? null,
        'Europe/London',
        input.deliverAt ?? new Date(Date.now() + 2 * 3600_000),
        'Y2lwaGVydGV4dA==',
        'aXZpdml2aXZpdml2',
        1,
        tok.hash,
        'enc:token',
        input.now ?? new Date(),
      ],
    ),
  );
  return { ...(row.r as { ok: boolean; letter_id: string; duplicate: boolean; invited: boolean }), token: tok.token };
}

/** Move a letter's clock forward without breaking immutability (test-only superuser edit). */
export async function backdate(db: TestDb, letterId: string, deliverAt: Date) {
  await db.sql(`alter table public.letters disable trigger letters_guard`);
  await db.sql(`update public.letters set deliver_at = $2, created_at = $2::timestamptz - interval '1 day' where id = $1`, [
    letterId,
    deliverAt,
  ]);
  await db.sql(`alter table public.letters enable trigger letters_guard`);
}
