import AsyncStorage from '@react-native-async-storage/async-storage';

// Attempts whose rate prompt card was closed with ✕, kept on this phone only
// (another device may show the card again; accepted). The card only looks at
// the last 48 h, so a short list of the newest ids is enough.
export const DISMISSED_KEY = 'rate-prompt-dismissed';
const MAX_KEPT = 20;

export function parseDismissed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

export async function loadDismissed(): Promise<string[]> {
  return parseDismissed(await AsyncStorage.getItem(DISMISSED_KEY));
}

// Newest first; the oldest ids drop off past MAX_KEPT.
export async function dismissAttempt(attemptId: string): Promise<string[]> {
  const current = await loadDismissed();
  const next = [attemptId, ...current.filter(id => id !== attemptId)].slice(
    0,
    MAX_KEPT,
  );
  await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  return next;
}
