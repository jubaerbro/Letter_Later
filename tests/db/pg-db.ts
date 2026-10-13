import type pg from 'pg';
import { DbError, type Db, type LetterEmailRow } from '@shared/services/db';

/**
 * Test implementation of the server's Db interface using node-postgres. Every call runs as
 * service_role, exactly like the Edge Functions' supabase-js client does in production.
 */
export class PgDb implements Db {
  constructor(private readonly client: pg.Client) {}

  private async asService<T>(fn: () => Promise<T>): Promise<T> {
    await this.client.query('begin');
    try {
      await this.client.query('set local role service_role');
      const r = await fn();
      await this.client.query('commit');
      return r;
    } catch (error) {
      await this.client.query('rollback');
      const e = error as { message: string; code?: string };
      throw new DbError(e.message, e.code ?? null);
    }
  }

  private call(fn: string, args: Record<string, unknown>) {
    const keys = Object.keys(args);
    const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
    return { sql: `public.${fn}(${named})`, values: keys.map((k) => args[k]) };
  }

  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { sql, values } = this.call(fn, args);
    return this.asService(async () => (await this.client.query(`select ${sql} as result`, values)).rows[0].result as T);
  }

  rpcRows<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
    const { sql, values } = this.call(fn, args);
    return this.asService(async () => (await this.client.query(`select * from ${sql}`, values)).rows as T[]);
  }

  letterEmailContext(letterId: string): Promise<LetterEmailRow | null> {
    return this.asService(async () => {
      const { rows } = await this.client.query(
        `select l.envelope_sender_name, l.envelope_sender_handle, l.deliver_at::text as deliver_at, l.sender_time_zone,
                p.display_name as recipient_name
         from public.letters l left join public.profiles p on p.id = l.recipient_id
         where l.id = $1`,
        [letterId],
      );
      return rows[0] ?? null;
    });
  }

  configInt(key: string): Promise<number> {
    return this.asService(async () => Number((await this.client.query(`select public.config_int($1) as v`, [key])).rows[0].v));
  }
}
