#!/usr/bin/env node
/**
 * Creates supabase/functions/.env with fresh random secrets (and the non-secret defaults),
 * ready for `supabase secrets set --env-file`. Refuses to overwrite an existing file so a key
 * that already encrypts letters can never be replaced by accident.
 *
 *   node scripts/generate-secrets.mjs [--web https://yourdomain] [--out path]
 */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'supabase/functions/.env';
const web = args.includes('--web') ? args[args.indexOf('--web') + 1] : 'https://laterletter.app';

if (existsSync(out)) {
  console.error(`${out} already exists. Not overwriting — an existing LETTER_ENCRYPTION_KEYS may already protect letters.`);
  console.error('To rotate the encryption key, ADD a new version (e.g. "1:old,2:new"); never remove old ones.');
  process.exit(1);
}

const hex = (n) => randomBytes(n).toString('hex');
const content = `# LaterLetter Edge Function secrets — generated ${new Date().toISOString()}
# NEVER commit this file. Back up LETTER_ENCRYPTION_KEYS offline: losing it makes all letters unreadable.
APP_ENV=production
LETTER_ENCRYPTION_KEYS=1:${randomBytes(32).toString('base64')}
WORKER_SECRET=${hex(32)}
EMAIL_OPTOUT_SECRET=${hex(32)}
REVENUECAT_WEBHOOK_AUTH=${hex(24)}
HEALTH_CHECK_TOKEN=${hex(24)}
WEB_BASE_URL=${web}

# Fill these in:
EMAIL_PROVIDER=resend
RESEND_API_KEY=
EMAIL_FROM="LaterLetter <hello@mail.${new URL(web).host}>"
REVENUECAT_SECRET_API_KEY=
EXPO_ACCESS_TOKEN=

# Development only (leave false in production):
ALLOW_TEST_CLOCK=false
MOCK_EMAIL_LOG_LINKS=false
`;
writeFileSync(out, content, { mode: 0o600 });
console.log(`Wrote ${out} (permissions 600).`);
console.log('Next: fill RESEND_API_KEY / REVENUECAT_SECRET_API_KEY, back up LETTER_ENCRYPTION_KEYS, then run `npm run check:env:server`.');
