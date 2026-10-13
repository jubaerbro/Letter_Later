import AsyncStorage from '@react-native-async-storage/async-storage';

/** Small, typed, device-local preferences. Nothing sensitive is stored here. */
export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  soundEffects: boolean;
  musicVolume: number;
  musicTrackId: string | null;
  musicBackground: boolean;
  musicWhileWriting: boolean;
  treeExperience: boolean;
  pushAsked: boolean;
}

const DEFAULTS: Prefs = {
  theme: 'system',
  soundEffects: true,
  musicVolume: 0.6,
  musicTrackId: null,
  musicBackground: true,
  musicWhileWriting: false,
  treeExperience: true,
  pushAsked: false,
};

const KEY = (k: string) => `ll.pref.${k}`;

export async function getPref<K extends keyof Prefs>(key: K): Promise<Prefs[K]> {
  try {
    const raw = await AsyncStorage.getItem(KEY(key));
    return raw === null ? DEFAULTS[key] : (JSON.parse(raw) as Prefs[K]);
  } catch {
    return DEFAULTS[key];
  }
}

export async function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY(key), JSON.stringify(value));
  } catch {
    // Preferences are a nicety; never crash over them.
  }
}

export const prefDefaults = DEFAULTS;
