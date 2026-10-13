import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backdate, createLetter, createUser, openDb, type TestDb } from './helpers';

let db: TestDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => db?.close());

const health = (now?: Date) =>
  db.asService((q) => q(`select public.ops_health(coalesce($1::timestamptz, now())) as r`, [now ?? null])).then((r) => r[0].r);

describe('operational health', () => {
  it('reports that the scheduler never ran on a fresh install', async () => {
    const h = await health();
    expect(h.healthy).toBe(false);
    expect(h.problems).toEqual(['scheduler_never_ran']);
  });

  it('is healthy right after a heartbeat, and stalls after 5 quiet minutes', async () => {
    await db.asService((q) => q(`select public.record_worker_heartbeat('{"delivered":0}'::jsonb)`));
    expect(await health()).toMatchObject({ healthy: true, problems: [] });
    const later = new Date(Date.now() + 6 * 60_000);
    expect((await health(later)).problems).toContain('scheduler_stalled');
  });

  it('flags overdue letters without revealing anything about them', async () => {
    const sender = await createUser(db);
    const { letter_id } = await createLetter(db, sender.id, { recipient: 'someone@example.com' });
    await backdate(db, letter_id, new Date(Date.now() - 30 * 60_000));
    await db.asService((q) => q(`select public.record_worker_heartbeat('{}'::jsonb)`));
    const h = await health();
    expect(h).toMatchObject({ healthy: false, letters_overdue: 1 });
    expect(h.oldest_overdue_minutes).toBeGreaterThanOrEqual(29);
    expect(JSON.stringify(h)).not.toContain(letter_id);
    expect(JSON.stringify(h)).not.toContain('someone@example.com');
  });

  it('is not callable by app users', async () => {
    const u = await createUser(db);
    await expect(db.asUser(u.id, (q) => q(`select public.ops_health()`))).rejects.toThrow(/permission denied/);
    await expect(db.asUser(u.id, (q) => q(`select public.record_worker_heartbeat('{}'::jsonb)`))).rejects.toThrow(/permission denied/);
    await expect(db.asUser(u.id, (q) => q(`select * from public.worker_heartbeats`))).rejects.toThrow(/permission denied/);
  });
});
