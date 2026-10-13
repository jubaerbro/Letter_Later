import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { registerPushToken, removePushToken } from './api';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

let lastToken: string | null = null;

export async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('letters', {
    name: 'Letters',
    description: 'When a letter arrives, is accepted, or is opened.',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 120, 80, 120],
    lightColor: '#5B7A52',
  });
}

export async function pushPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unavailable'> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unavailable';
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * Asks for permission (only after the user chose "Yes, gently remind me") and registers the
 * Expo push token with the server. Returns false when unavailable or declined.
 */
export async function enablePush(): Promise<boolean> {
  if (Platform.OS === 'web' || !Device.isDevice) return false;
  await ensureChannel();
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return false;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return false; // EAS project not configured yet (development)
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  lastToken = token;
  await registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  return true;
}

/** Re-registers silently on launch if permission was already granted. */
export async function refreshPushRegistration() {
  if ((await pushPermissionStatus()) === 'granted') await enablePush().catch(() => {});
}

/** Called before sign-out so the next person on this device does not get these alerts. */
export async function unregisterPush() {
  if (lastToken) await removePushToken(lastToken).catch(() => {});
  lastToken = null;
}
