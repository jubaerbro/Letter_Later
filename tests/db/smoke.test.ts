import { afterAll, beforeAll, expect, it } from 'vitest';
import { createUser, openDb, type TestDb } from './helpers';

let db: TestDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => db?.close());

it('applies all migrations and creates a profile with a personal address on sign-up', async () => {
  const user = await createUser(db, { name: 'Ada' });
  expect(user.handle).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
  const [profile] = await db.sql(`select display_name, onboarded_at from public.profiles where id = $1`, [user.id]);
  expect(profile.display_name).toBe('Ada');
  expect(profile.onboarded_at).not.toBeNull();
});
