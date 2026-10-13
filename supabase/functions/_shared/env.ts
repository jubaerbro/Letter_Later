/**
 * Configuration checks shared by the Edge Functions (at startup) and by
 * `npm run check:env` (before deploying or building). Dependency-free so it runs in Deno,
 * Node and tests alike.
 *
 * Errors block a deploy/build; warnings are things that work but deserve a look.
 */

export type Get = (key: string) => string | undefined;

export interface EnvIssue {
  key: string;
  severity: 'error' | 'warning';
  message: string;
}

const PLACEHOLDER = /REPLACE_WITH|your-project|your-anon|changeme|example\.com/i;

function b64Bytes(s: string): number {
  try {
    return atob(s).length;
  } catch {
    return -1;
  }
}

function jwtRole(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4)));
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

const isHttpsUrl = (v: string) => /^https:\/\/[^\s/]+\.[^\s/]+/.test(v);
const isLocalhost = (v: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(v);

/** Secrets and settings for the Edge Functions. */
export function checkServerEnv(get: Get, opts: { production: boolean }): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const err = (key: string, message: string) => issues.push({ key, severity: 'error', message });
  const warn = (key: string, message: string) => issues.push({ key, severity: 'warning', message });
  const val = (k: string) => (get(k) ?? '').trim();

  // Encryption keys
  const keys = val('LETTER_ENCRYPTION_KEYS');
  if (!keys || PLACEHOLDER.test(keys)) {
    err('LETTER_ENCRYPTION_KEYS', 'missing — generate with `npm run secrets:generate`');
  } else {
    const versions = new Set<number>();
    for (const entry of keys.split(',').map((e) => e.trim()).filter(Boolean)) {
      const [v, material] = entry.split(':');
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) err('LETTER_ENCRYPTION_KEYS', `entry "${v}:…" needs a positive integer version`);
      else if (versions.has(n)) err('LETTER_ENCRYPTION_KEYS', `version ${n} appears twice`);
      versions.add(n);
      if (b64Bytes(material ?? '') !== 32) err('LETTER_ENCRYPTION_KEYS', `version ${v} must be base64 of exactly 32 random bytes`);
    }
  }

  for (const key of ['WORKER_SECRET', 'EMAIL_OPTOUT_SECRET']) {
    const v = val(key);
    if (!v || PLACEHOLDER.test(v)) err(key, 'missing — generate with `npm run secrets:generate`');
    else if (v.length < 32) err(key, 'must be at least 32 characters');
  }

  const web = val('WEB_BASE_URL');
  if (!web) err('WEB_BASE_URL', 'missing (the public site that hosts /claim and /letter pages)');
  else if (!isHttpsUrl(web) && !(isLocalhost(web) && !opts.production)) err('WEB_BASE_URL', 'must be an https:// URL');
  else if (web.endsWith('/')) warn('WEB_BASE_URL', 'drop the trailing slash');

  const provider = (val('EMAIL_PROVIDER') || 'mock').toLowerCase();
  if (provider !== 'mock' && provider !== 'resend') err('EMAIL_PROVIDER', 'must be "mock" or "resend"');
  if (provider === 'resend') {
    if (!/^re_[A-Za-z0-9_]{10,}$/.test(val('RESEND_API_KEY'))) err('RESEND_API_KEY', 'missing or not a Resend API key (starts with re_)');
    if (!/@[^\s>]+\.[a-z]{2,}/i.test(val('EMAIL_FROM'))) err('EMAIL_FROM', 'must be a sender on your verified domain, e.g. "LaterLetter <hello@mail.yourdomain.com>"');
  }

  if (opts.production) {
    if (provider === 'mock') err('EMAIL_PROVIDER', 'is "mock" — production must send real email (set to "resend")');
    if (val('ALLOW_TEST_CLOCK') === 'true') err('ALLOW_TEST_CLOCK', 'must not be enabled in production');
    if (val('MOCK_EMAIL_LOG_LINKS') === 'true') err('MOCK_EMAIL_LOG_LINKS', 'must not be enabled in production (it logs claim links)');
    if (val('PUSH_PROVIDER') === 'mock') err('PUSH_PROVIDER', 'is "mock" — production must send real push notifications');
  } else if (val('ALLOW_TEST_CLOCK') === 'true') {
    warn('ALLOW_TEST_CLOCK', 'enabled — fine for development, never for production');
  }

  const health = val('HEALTH_CHECK_TOKEN');
  if (!health || PLACEHOLDER.test(health)) warn('HEALTH_CHECK_TOKEN', 'not set — the /health endpoint for uptime monitoring is disabled');
  else if (health.length < 24) err('HEALTH_CHECK_TOKEN', 'must be at least 24 characters');

  const rcSecret = val('REVENUECAT_SECRET_API_KEY');
  if (!rcSecret) {
    warn('REVENUECAT_SECRET_API_KEY', 'not set — subscriptions cannot be verified (Plus will not activate)');
  } else {
    if (/^goog_|^appl_/.test(rcSecret)) err('REVENUECAT_SECRET_API_KEY', 'this is a PUBLIC SDK key; use the secret key (sk_…)');
    const hook = val('REVENUECAT_WEBHOOK_AUTH');
    if (!hook || PLACEHOLDER.test(hook) || hook.length < 24) err('REVENUECAT_WEBHOOK_AUTH', 'must be a random value of at least 24 characters');
  }
  return issues;
}

/** Public values baked into the app. Catches the classic "service key in the app" mistake. */
export function checkAppEnv(get: Get, opts: { production: boolean }): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const err = (key: string, message: string) => issues.push({ key, severity: 'error', message });
  const warn = (key: string, message: string) => issues.push({ key, severity: 'warning', message });
  const val = (k: string) => (get(k) ?? '').trim();

  const url = val('EXPO_PUBLIC_SUPABASE_URL');
  if (!url || PLACEHOLDER.test(url)) err('EXPO_PUBLIC_SUPABASE_URL', 'missing (https://<project-ref>.supabase.co)');
  else if (!isHttpsUrl(url) && !(isLocalhost(url) && !opts.production)) err('EXPO_PUBLIC_SUPABASE_URL', 'must be an https:// URL');

  const anon = val('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!anon || PLACEHOLDER.test(anon)) err('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'missing (Project settings → API keys → anon/publishable)');
  else if (anon.startsWith('sb_secret_') || jwtRole(anon) === 'service_role') {
    err('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'this is the SERVICE ROLE / secret key — it must never ship in the app. Use the anon/publishable key and rotate the secret key now.');
  }

  const web = val('EXPO_PUBLIC_WEB_BASE_URL');
  if (!web) (opts.production ? err : warn)('EXPO_PUBLIC_WEB_BASE_URL', 'missing (where invitation links and App Links point)');
  else if (!isHttpsUrl(web) && !(isLocalhost(web) && !opts.production)) err('EXPO_PUBLIC_WEB_BASE_URL', 'must be an https:// URL');

  const rc = val('EXPO_PUBLIC_REVENUECAT_ANDROID_KEY');
  if (rc && !rc.startsWith('goog_')) err('EXPO_PUBLIC_REVENUECAT_ANDROID_KEY', 'must be the public Google Play SDK key (starts with goog_), never a secret key');
  if (!rc && opts.production) warn('EXPO_PUBLIC_REVENUECAT_ANDROID_KEY', 'not set — the Plus paywall will say purchases are unavailable');

  const support = val('EXPO_PUBLIC_SUPPORT_EMAIL');
  if (opts.production && (!support || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(support))) err('EXPO_PUBLIC_SUPPORT_EMAIL', 'a real support address is required (Play policy and account deletion)');

  const pkg = val('ANDROID_PACKAGE') || 'app.laterletter.mobile';
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(pkg)) err('ANDROID_PACKAGE', 'not a valid Android application id');

  const project = val('EAS_PROJECT_ID');
  if (opts.production && !/^[0-9a-f-]{36}$/i.test(project)) err('EAS_PROJECT_ID', 'required for production builds (push notifications and updates)');
  return issues;
}

export function formatIssues(title: string, issues: EnvIssue[]): string {
  if (issues.length === 0) return `✓ ${title}: OK`;
  return [`${title}:`, ...issues.map((i) => `  ${i.severity === 'error' ? '✗' : '!'} ${i.key}: ${i.message}`)].join('\n');
}
