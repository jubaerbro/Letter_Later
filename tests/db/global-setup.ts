/**
 * Starts a real PostgreSQL 17 (embedded-postgres, no Docker), applies the Supabase shim and
 * every migration into a template database. Each test file clones the template, so files
 * are isolated and can run in parallel.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

const ROOT = join(__dirname, '..', '..');
const PORT = 54329 + Math.floor(Math.random() * 500);

export default async function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), 'letter-later-pg-'));
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port: PORT,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    // Postgres refuses to run as root; only in root-only containers do we let the library
    // create an unprivileged OS user. Never enabled on a normal developer machine.
    createPostgresUser: isRoot,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();

  const admin = pg.getPgClient();
  await admin.connect();
  await admin.query('create database template_ll');
  await admin.end();

  const db = pg.getPgClient('template_ll');
  await db.connect();
  await db.query(readFileSync(join(ROOT, 'tests/db/supabase-shim.sql'), 'utf8'));
  const migrationsDir = join(ROOT, 'supabase/migrations');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.query(readFileSync(join(migrationsDir, file), 'utf8'));
    } catch (error) {
      await db.end();
      await pg.stop();
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  await db.end();

  project.provide('pgPort', PORT);

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgPort: number;
  }
}
