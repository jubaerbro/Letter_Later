#!/usr/bin/env node
/**
 * Deploys the whole backend to a hosted Supabase project in one go — no Docker:
 *   1. validates Edge Function secrets (production rules unless --allow-dev)
 *   2. links the project and applies database migrations
 *   3. uploads Edge Function secrets
 *   4. deploys every Edge Function (server-side bundling)
 *   5. stores the scheduler's secrets in Vault (Supabase Management API)
 *   6. smoke-tests the deployment (health + an authenticated scheduler tick)
 *
 * Environment:
 *   SUPABASE_ACCESS_TOKEN   personal access token (dashboard → Account → Access tokens)
 *   SUPABASE_PROJECT_REF    project reference id
 *   SUPABASE_DB_PASSWORD    database password (for migrations)
 * Secrets file: supabase/functions/.env (create with `npm run secrets:generate`).
 *
 * Flags: --dry-run  --allow-dev  --skip-migrations  --skip-secrets  --skip-functions  --env-file <path>
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { checkServerEnv, formatIssues } from '../supabase/functions/_shared/env.ts';
import { parseDotenv, projectUrl, vaultUpsertSql } from './lib/deploy-helpers.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const dry = flag('--dry-run');
const envFile = flag('--env-file') ? args[args.indexOf('--env-file') + 1] : 'supabase/functions/.env';

const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const missing = ['SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN', ...(flag('--skip-migrations') ? [] : ['SUPABASE_DB_PASSWORD'])].filter((k) => !process.env[k]);
if (missing.length && !dry) {
  console.error(`Missing environment: ${missing.join(', ')}`);
  process.exit(1);
}
const base = ref ? projectUrl(ref) : 'https://<project-ref>.supabase.co';

// 1. Secrets
if (!existsSync(envFile)) {
  console.error(`${envFile} not found. Run \`npm run secrets:generate\` first.`);
  process.exit(1);
}
const secrets = parseDotenv(envFile);
const issues = checkServerEnv((k) => secrets[k], { production: !flag('--allow-dev') });
console.log(formatIssues('Edge Function secrets', issues));
if (issues.some((i) => i.severity === 'error')) {
  console.error('\nFix the errors above (or pass --allow-dev for a development project).');
  process.exit(1);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
function run(title, cmd, cmdArgs) {
  console.log(`\n▸ ${title}\n  $ ${[cmd, ...cmdArgs].join(' ')}`);
  if (dry) return;
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`\n✗ ${title} failed.`);
    process.exit(r.status ?? 1);
  }
}

// 2. Database
if (!flag('--skip-migrations')) {
  run('Link project', npx, ['supabase', 'link', '--project-ref', ref ?? '<ref>']);
  run('Apply migrations', npx, ['supabase', 'db', 'push']);
}
// 3. Function secrets (SUPABASE_URL / SERVICE_ROLE_KEY are injected by Supabase itself)
if (!flag('--skip-secrets')) run('Upload Edge Function secrets', npx, ['supabase', 'secrets', 'set', '--env-file', envFile, '--project-ref', ref ?? '<ref>']);
// 4. Functions
if (!flag('--skip-functions')) run('Deploy Edge Functions', npx, ['supabase', 'functions', 'deploy', '--project-ref', ref ?? '<ref>', '--use-api']);

// 5. Vault secrets for pg_cron
const sql = vaultUpsertSql({ project_url: base, worker_secret: secrets.WORKER_SECRET });
const redacted = (text) => text.split(secrets.WORKER_SECRET).join('<WORKER_SECRET>'); // never print secrets
console.log('\n▸ Store scheduler secrets in Vault');
if (dry) {
  console.log('  (dry run) would run via the Management API:\n' + redacted(sql));
} else {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    console.error(`✗ Could not store Vault secrets (${res.status}). Run this in the SQL editor instead:\n`);
    console.error(redacted(sql));
    console.error('\n(Replace <WORKER_SECRET> with the value from your .env file.)');
    process.exit(1);
  }
  console.log('  ✓ project_url and worker_secret stored');
}

// 6. Smoke test
console.log('\n▸ Smoke test');
if (dry) {
  console.log('  (dry run) skipped');
} else {
  const tick = await fetch(`${base}/functions/v1/deliver-due`, { method: 'POST', headers: { Authorization: `Bearer ${secrets.WORKER_SECRET}`, 'Content-Type': 'application/json' }, body: '{}' });
  const tickBody = await tick.json().catch(() => ({}));
  console.log(tick.ok ? `  ✓ scheduler tick OK (email provider: ${tickBody.emailProvider}${tickBody.mockEmail ? ', MOCK' : ''})` : `  ✗ scheduler tick returned ${tick.status} ${JSON.stringify(tickBody)}`);
  if (secrets.HEALTH_CHECK_TOKEN) {
    const h = await fetch(`${base}/functions/v1/health?token=${secrets.HEALTH_CHECK_TOKEN}`);
    const body = await h.json().catch(() => ({}));
    console.log(`  ${h.ok ? '✓' : '!'} health ${h.status}: ${JSON.stringify(body.problems ?? body)}`);
  }
  if (!tick.ok) process.exit(1);
}

console.log(`\nBackend deployed to ${base}.
Remaining one-time dashboard steps (see docs/DEPLOY.md): custom SMTP + OTP email template, Site URL.`);
