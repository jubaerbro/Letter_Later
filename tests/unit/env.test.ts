import { describe, expect, it } from 'vitest';
import { checkAppEnv, checkServerEnv } from '@shared/env';
import { emailProviderFromEnv } from '@shared/email/provider';

const key = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const goodServer: Record<string, string> = {
  APP_ENV: 'production',
  LETTER_ENCRYPTION_KEYS: `1:${key()},2:${key()}`,
  WORKER_SECRET: 'w'.repeat(64),
  EMAIL_OPTOUT_SECRET: 'o'.repeat(64),
  WEB_BASE_URL: 'https://laterletter.app',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_abcdefghijklmnop',
  EMAIL_FROM: 'LaterLetter <hello@mail.laterletter.app>',
  REVENUECAT_SECRET_API_KEY: 'sk_abcdef',
  REVENUECAT_WEBHOOK_AUTH: 'r'.repeat(32),
  HEALTH_CHECK_TOKEN: 'h'.repeat(32),
};
const errors = (issues: { severity: string; key: string }[]) => issues.filter((i) => i.severity === 'error').map((i) => i.key);
const server = (patch: Record<string, string | undefined>, production = true) =>
  errors(checkServerEnv((k) => ({ ...goodServer, ...patch })[k], { production }));

describe('server configuration checks', () => {
  it('accepts a complete production configuration', () => {
    expect(checkServerEnv((k) => goodServer[k], { production: true })).toEqual([]);
  });
  it('rejects mock email, test clock and link logging in production', () => {
    expect(server({ EMAIL_PROVIDER: 'mock' })).toContain('EMAIL_PROVIDER');
    expect(server({ ALLOW_TEST_CLOCK: 'true' })).toContain('ALLOW_TEST_CLOCK');
    expect(server({ MOCK_EMAIL_LOG_LINKS: 'true' })).toContain('MOCK_EMAIL_LOG_LINKS');
    expect(server({ PUSH_PROVIDER: 'mock' })).toContain('PUSH_PROVIDER');
    expect(server({ EMAIL_PROVIDER: 'mock', ALLOW_TEST_CLOCK: 'true' }, false)).toEqual([]);
  });
  it('rejects weak or malformed secrets and keys', () => {
    expect(server({ LETTER_ENCRYPTION_KEYS: '1:short' })).toContain('LETTER_ENCRYPTION_KEYS');
    expect(server({ LETTER_ENCRYPTION_KEYS: `1:${key()},1:${key()}` })).toContain('LETTER_ENCRYPTION_KEYS');
    expect(server({ LETTER_ENCRYPTION_KEYS: '1:REPLACE_WITH_BASE64_32_BYTES' })).toContain('LETTER_ENCRYPTION_KEYS');
    expect(server({ WORKER_SECRET: 'tooshort' })).toContain('WORKER_SECRET');
    expect(server({ WEB_BASE_URL: 'http://laterletter.app' })).toContain('WEB_BASE_URL');
    expect(server({ RESEND_API_KEY: 'nope' })).toContain('RESEND_API_KEY');
    expect(server({ REVENUECAT_SECRET_API_KEY: 'goog_public' })).toContain('REVENUECAT_SECRET_API_KEY');
    expect(server({ REVENUECAT_WEBHOOK_AUTH: 'x' })).toContain('REVENUECAT_WEBHOOK_AUTH');
  });
  it('the email factory refuses mock email in production', () => {
    expect(() => emailProviderFromEnv((k) => ({ APP_ENV: 'production', EMAIL_PROVIDER: 'mock' })[k])).toThrow(/requires EMAIL_PROVIDER=resend/);
    expect(emailProviderFromEnv((k) => ({ EMAIL_PROVIDER: 'mock' })[k as 'EMAIL_PROVIDER']).isMock).toBe(true);
  });
});

describe('app configuration checks', () => {
  const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const good: Record<string, string> = {
    EXPO_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: `${b64url({ alg: 'HS256' })}.${b64url({ role: 'anon' })}.sig`,
    EXPO_PUBLIC_WEB_BASE_URL: 'https://laterletter.app',
    EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: 'goog_abc',
    EXPO_PUBLIC_SUPPORT_EMAIL: 'support@laterletter.app',
    EAS_PROJECT_ID: '0c5a3c0e-1111-4222-8333-444455556666',
  };
  const app = (patch: Record<string, string>) => errors(checkAppEnv((k) => ({ ...good, ...patch })[k], { production: true }));

  it('accepts a complete production configuration', () => {
    expect(app({})).toEqual([]);
  });
  it('blocks shipping a service-role or secret key inside the app', () => {
    expect(app({ EXPO_PUBLIC_SUPABASE_ANON_KEY: `${b64url({ alg: 'HS256' })}.${b64url({ role: 'service_role' })}.sig` })).toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    expect(app({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_abcdefghijklmnopqrstuvwxyz' })).toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    expect(app({ EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: 'sk_secret' })).toContain('EXPO_PUBLIC_REVENUECAT_ANDROID_KEY');
  });
  it('requires production essentials', () => {
    expect(app({ EAS_PROJECT_ID: '' })).toContain('EAS_PROJECT_ID');
    expect(app({ EXPO_PUBLIC_SUPPORT_EMAIL: '' })).toContain('EXPO_PUBLIC_SUPPORT_EMAIL');
    expect(app({ ANDROID_PACKAGE: 'Not A Package' })).toContain('ANDROID_PACKAGE');
  });
});
