import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { config } from './config';

/**
 * The app only ever holds the public anon/publishable key. Every read and write is checked
 * by row-level security and SECURITY DEFINER functions on the server.
 */
export const supabase = createClient(
  config.isConfigured ? config.supabaseUrl : 'https://not-configured.invalid',
  config.isConfigured ? config.supabaseAnonKey : 'not-configured',
  {
    auth: {
      storage: Platform.OS === 'web' ? undefined : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
      lock: processLock,
    },
  },
);

if (Platform.OS !== 'web') {
  // Refresh tokens only while the app is in the foreground (battery-friendly).
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
