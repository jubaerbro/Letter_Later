import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Device-local memory of subjects for letters you have opened or sent, so mailbox search can
 * find them. Stays on this device only; cleared on sign-out. Letter bodies are never cached.
 */
const KEY = 'll.subjects';
export const PENDING_CLAIM_KEY = 'll.pendingClaim';

export async function rememberSubject(letterId: string, subject: string) {
  if (!subject.trim()) return;
  try {
    const map = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}') as Record<string, string>;
    map[letterId] = subject.slice(0, 120);
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch {}
}

export async function rememberedSubjects(): Promise<Record<string, string>> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}');
  } catch {
    return {};
  }
}

export async function clearLocalLetterData() {
  await AsyncStorage.multiRemove([KEY, PENDING_CLAIM_KEY]).catch(() => {});
}
