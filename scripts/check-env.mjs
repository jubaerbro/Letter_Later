#!/usr/bin/env node
/**
 * Validates configuration before a deploy or build.
 *
 *   node scripts/check-env.mjs app [--production]                 # values in process.env / .env.local
 *   node scripts/check-env.mjs server [--production] [--file F]  # Edge Function secrets (default supabase/functions/.env)
 *
 * Exits 1 on any error. Prints key names and problems only — never secret values.
 * Runs automatically on EAS before production builds (package.json "eas-build-pre-install").
 */
import { existsSync } from 'node:fs';
import { checkAppEnv, checkServerEnv, formatIssues } from '../supabase/functions/_shared/env.ts';
import { parseDotenv } from './lib/deploy-helpers.mjs';

const args = process.argv.slice(2);
const target = args[0];
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const production = args.includes('--production') || (process.env.EAS_BUILD === 'true' && process.env.APP_VARIANT === 'production');


let issues;
if (target === 'app') {
  const fromFile = { ...parseDotenv('.env'), ...parseDotenv('.env.local') };
  issues = checkAppEnv((k) => process.env[k] ?? fromFile[k], { production });
  console.log(formatIssues(`App configuration${production ? ' (production)' : ''}`, issues));
} else if (target === 'server') {
  const path = fileArg ?? 'supabase/functions/.env';
  const fromFile = parseDotenv(path);
  if (!existsSync(path) && !fileArg) console.log(`(no ${path}; checking process environment)`);
  issues = checkServerEnv((k) => fromFile[k] ?? process.env[k], { production });
  console.log(formatIssues(`Edge Function secrets${production ? ' (production)' : ''}`, issues));
} else {
  console.error('Usage: node scripts/check-env.mjs <app|server> [--production] [--file path]');
  process.exit(2);
}
// On EAS, only production builds are blocked; development/preview builds just get the report.
const informational = process.env.EAS_BUILD === 'true' && !production;
process.exit(!informational && issues.some((i) => i.severity === 'error') ? 1 : 0);
