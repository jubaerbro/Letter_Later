// Small, pure helpers for the deploy scripts (unit tested in tests/unit/deploy.test.ts).
import { existsSync, readFileSync } from 'node:fs';

export function parseDotenv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const literal = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** Idempotently creates or updates the Vault secrets the pg_cron job reads. */
export function vaultUpsertSql(secrets) {
  const blocks = Object.entries(secrets).map(([name, value]) => {
    if (!/^[a-z_]+$/.test(name)) throw new Error(`bad secret name ${name}`);
    return `  if exists (select 1 from vault.secrets where name = ${literal(name)}) then
    perform vault.update_secret((select id from vault.secrets where name = ${literal(name)}), ${literal(value)});
  else
    perform vault.create_secret(${literal(value)}, ${literal(name)});
  end if;`;
  });
  return `do $$\nbegin\n${blocks.join('\n')}\nend\n$$;`;
}

export function projectUrl(ref) {
  if (!/^[a-z0-9]{15,40}$/.test(ref ?? '')) throw new Error('SUPABASE_PROJECT_REF looks wrong (Project settings → General → Reference ID)');
  return `https://${ref}.supabase.co`;
}
