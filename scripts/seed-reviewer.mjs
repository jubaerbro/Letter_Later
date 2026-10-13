#!/usr/bin/env node
/**
 * Creates (or refreshes) the Google Play review account with a password and two demo letters:
 * one ready to open, one growing. Safe to re-run.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… LETTER_ENCRYPTION_KEYS=… \
 *   REVIEWER_EMAIL=review@yourdomain.com REVIEWER_PASSWORD='a long password' \
 *   [WORKER_SECRET=…] node --no-warnings scripts/seed-reviewer.mjs
 *
 * Put the same email/password in Play Console → App content → App access.
 */
import { loadKeyRing } from '../supabase/functions/_shared/crypto.ts';
import { reviewerLetterArgs } from '../supabase/functions/_shared/services/reviewer.ts';

const env = (k, fallback) => process.env[k] ?? (fallback ? process.env[fallback] : undefined);
const URL_ = env('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL')?.replace(/\/$/, '');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
const ANON = env('SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
const EMAIL = env('REVIEWER_EMAIL')?.trim().toLowerCase();
const PASSWORD = env('REVIEWER_PASSWORD');
const missing = Object.entries({ SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON, LETTER_ENCRYPTION_KEYS: env('LETTER_ENCRYPTION_KEYS'), REVIEWER_EMAIL: EMAIL, REVIEWER_PASSWORD: PASSWORD })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing: ${missing.join(', ')}`);
  process.exit(1);
}
if (PASSWORD.length < 12) {
  console.error('REVIEWER_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

async function call(path, { key, token, body, method = 'POST' }) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

// 1. Account with a confirmed email and a password (reviewers can't receive codes).
const created = await call('/auth/v1/admin/users', { key: SERVICE, body: { email: EMAIL, password: PASSWORD, email_confirm: true } });
if (created.ok) console.log('✓ Reviewer account created');
else if (created.status === 422 || /already/i.test(JSON.stringify(created.data))) console.log('• Reviewer account already exists');
else throw new Error(`Could not create account: ${created.status} ${JSON.stringify(created.data)}`);

const login = await call('/auth/v1/token?grant_type=password', { key: ANON, body: { email: EMAIL, password: PASSWORD } });
if (!login.ok) throw new Error(`Sign-in failed (${login.status}). If the account existed before, reset its password in the dashboard.`);
const userId = login.data.user.id;
const token = login.data.access_token;

// 2. Onboarding as the user (terms + age confirmation recorded exactly like a real sign-up).
const onboard = await call('/rest/v1/rpc/complete_onboarding', {
  key: ANON,
  token,
  body: { p_display_name: 'Play Reviewer', p_time_zone: 'UTC', p_hemisphere: 'north', p_accept_terms: true, p_confirm_age: true },
});
if (!onboard.ok || onboard.data?.ok === false) throw new Error(`Onboarding failed: ${JSON.stringify(onboard.data)}`);
console.log('✓ Onboarded');

// 3. Demo letters (encrypted exactly like real ones; idempotent).
const ring = await loadKeyRing(env('LETTER_ENCRYPTION_KEYS'));
for (const args of await reviewerLetterArgs(ring, { userId, email: EMAIL, timeZone: 'UTC', now: new Date() })) {
  const r = await call('/rest/v1/rpc/create_letter_record', { key: SERVICE, body: args });
  if (!r.ok) throw new Error(`Letter ${args.p_idempotency_key} failed: ${JSON.stringify(r.data)}`);
  console.log(`✓ Letter ${args.p_idempotency_key}${r.data.duplicate ? ' (already there)' : ''}`);
}

// 4. Deliver the past-due welcome letter now (otherwise the scheduler does it within a minute).
if (process.env.WORKER_SECRET) {
  const tick = await call('/functions/v1/deliver-due', { key: ANON, token: process.env.WORKER_SECRET, body: {} });
  console.log(tick.ok ? `✓ Delivery tick: ${tick.data.delivered} delivered` : `! Delivery tick failed (${tick.status}); the scheduler will deliver it shortly`);
}
console.log(`\nDone. Give Play Console → App access: ${EMAIL} / (the password you set).`);
