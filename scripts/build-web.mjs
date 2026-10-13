#!/usr/bin/env node
/**
 * Builds the public website (claim / open / account-deletion pages and the full web app) into
 * dist/, and writes /.well-known/assetlinks.json so Android App Links open the installed app.
 *
 *   ANDROID_CERT_SHA256="AA:BB:…[,CC:DD:…]" npm run build:web
 *
 * ANDROID_CERT_SHA256: Play Console → Test and release → App integrity → App signing key
 * certificate → SHA-256 (add the upload key's too if you install builds outside Play).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkAppEnv, formatIssues } from '../supabase/functions/_shared/env.ts';

const production = process.argv.includes('--production') || process.env.CONTEXT === 'production' || process.env.VERCEL_ENV === 'production';
const issues = checkAppEnv((k) => process.env[k], { production: false }).filter((i) => i.key !== 'EAS_PROJECT_ID');
console.log(formatIssues('Web configuration', issues));
if (issues.some((i) => i.severity === 'error')) process.exit(1);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const r = spawnSync(npx, ['expo', 'export', '--platform', 'web'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) process.exit(r.status ?? 1);

const pkg = process.env.ANDROID_PACKAGE || 'app.laterletter.mobile';
const prints = (process.env.ANDROID_CERT_SHA256 ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const bad = prints.filter((p) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(p));
if (bad.length) {
  console.error(`ANDROID_CERT_SHA256 must be colon-separated SHA-256 fingerprints; got: ${bad.join(', ')}`);
  process.exit(1);
}
if (prints.length === 0) {
  const msg = 'ANDROID_CERT_SHA256 not set — invitation links will open in the browser instead of the app.';
  if (production) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.warn(`! ${msg}`);
} else {
  mkdirSync(join('dist', '.well-known'), { recursive: true });
  writeFileSync(
    join('dist', '.well-known', 'assetlinks.json'),
    JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints } }], null, 2),
  );
  console.log(`✓ assetlinks.json for ${pkg} (${prints.length} fingerprint${prints.length > 1 ? 's' : ''})`);
}
