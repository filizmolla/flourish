import AsyncStorage from '@react-native-async-storage/async-storage';
import { CookingClock } from './cookingClock';
import { CookingLine } from './cookingLines';
import { CookingTimer } from './cookingTimers';

// Cooking progress kept on the phone, one draft per recipe. Nothing goes to
// the server until Finish turns it into an attempt. Times are epoch ms.
export type CookingDraft = {
  version: 1;
  recipeId: string;
  basedOnAttemptId?: string; // when started from "Cook this version again"
  basedOnMadeAt?: string; // that attempt's date (ISO), for the banner
  startedAt: number; // for "You started this 2 h ago"
  savedAt: number;
  elapsedMs: number; // cooking time banked so far
  activeSince?: number; // set while cooking mode was open at save time
  ingredients: CookingLine[] | null; // null = unchanged from the recipe
  instructions: CookingLine[] | null;
  checkedIngredients: number[];
  checkedSteps: number[];
  notes: string;
  timers: CookingTimer[];
};

export function draftKey(recipeId: string): string {
  return `cooking-draft:${recipeId}`;
}

// The clock to continue with. If the app was closed while the clock ran,
// only the time up to the last save counts: time away never does.
export function clockFromDraft(draft: CookingDraft, now: number): CookingClock {
  const unbanked =
    draft.activeSince === undefined
      ? 0
      : Math.max(0, draft.savedAt - draft.activeSince);
  return { elapsedMs: draft.elapsedMs + unbanked, activeSince: now };
}

// Anything unreadable (old format, broken JSON, other recipe) counts as no
// draft, so cooking mode always opens.
export function parseDraft(
  json: string | null,
  recipeId: string,
): CookingDraft | null {
  if (!json) return null;
  try {
    const draft = JSON.parse(json);
    if (draft?.version !== 1 || draft.recipeId !== recipeId) return null;
    return draft as CookingDraft;
  } catch {
    return null;
  }
}

export async function loadDraft(
  recipeId: string,
): Promise<CookingDraft | null> {
  return parseDraft(await AsyncStorage.getItem(draftKey(recipeId)), recipeId);
}

export function saveDraft(draft: CookingDraft): Promise<void> {
  return AsyncStorage.setItem(draftKey(draft.recipeId), JSON.stringify(draft));
}

export function clearDraft(recipeId: string): Promise<void> {
  return AsyncStorage.removeItem(draftKey(recipeId));
}
