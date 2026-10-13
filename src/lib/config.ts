/**
 * Public runtime configuration. EXPO_PUBLIC_* values are inlined at build time and are
 * visible to anyone with the app, so they must never be secrets.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const config = {
  supabaseUrl,
  supabaseAnonKey,
  webBaseUrl: (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'https://letterlater.app').replace(/\/$/, ''),
  revenueCatAndroidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'support@letterlater.app',
  isConfigured: /^https:\/\/.+/.test(supabaseUrl) && supabaseAnonKey.length > 20,
};
