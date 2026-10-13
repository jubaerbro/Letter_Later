/**
 * The narrow database surface the server code needs. Production implements it with
 * supabase-js (service role) in ../supabase.ts; tests implement it with node-postgres
 * against the real migrations. Every call maps to one SQL function, so the authorization
 * and idempotency rules live in one place: the database.
 */
export class DbError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

export interface LetterEmailRow {
  envelope_sender_name: string | null;
  envelope_sender_handle: string | null;
  deliver_at: string;
  sender_time_zone: string;
  recipient_name: string | null;
}

export interface Db {
  /** Call a function returning a single value (jsonb/text/boolean/integer). */
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** Call a set-returning function. */
  rpcRows<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T[]>;
  letterEmailContext(letterId: string): Promise<LetterEmailRow | null>;
  configInt(key: string): Promise<number>;
}
