import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDotenv, projectUrl, vaultUpsertSql } from '../../scripts/lib/deploy-helpers.mjs';

describe('deploy helpers', () => {
  it('builds idempotent, safely quoted Vault SQL', () => {
    const sql = vaultUpsertSql({ project_url: 'https://abc.supabase.co', worker_secret: "it's-secret" });
    expect(sql).toContain("vault.create_secret('it''s-secret', 'worker_secret')");
    expect(sql).toContain("vault.update_secret((select id from vault.secrets where name = 'project_url'), 'https://abc.supabase.co')");
    expect(sql.match(/if exists/g)).toHaveLength(2);
    expect(() => vaultUpsertSql({ "x'; drop table y; --": 'v' })).toThrow(/bad secret name/);
  });

  it('validates the project reference', () => {
    expect(projectUrl('abcdefghijklmnopqrst')).toBe('https://abcdefghijklmnopqrst.supabase.co');
    expect(() => projectUrl('https://abc.supabase.co')).toThrow();
  });

  it('parses dotenv files including quoted values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'll-env-'));
    const file = join(dir, '.env');
    writeFileSync(file, '# comment\nA=1\nEMAIL_FROM="LaterLetter <hi@x.app>"\n  B = two \n');
    expect(parseDotenv(file)).toEqual({ A: '1', EMAIL_FROM: 'LaterLetter <hi@x.app>', B: 'two' });
    expect(parseDotenv(join(dir, 'missing'))).toEqual({});
  });
});
