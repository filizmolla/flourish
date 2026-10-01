import { FoodGroup, Nutrient, RecipeLine } from '../api/recipesClient';

// Dot order, left to right: protein, fiber, healthy fat.
export const NUTRIENTS: Nutrient[] = [
  FoodGroup.Protein,
  FoodGroup.Fiber,
  FoodGroup.HealthyFat,
];

// How filled a nutrient's dot is. Never shown as a number.
export enum NutrientState {
  None = 'none',
  Some = 'some',
  Full = 'full',
}

export type NutrientStates = Record<Nutrient, NutrientState>;

function statesFrom(pick: (nutrient: Nutrient) => NutrientState) {
  return Object.fromEntries(
    NUTRIENTS.map(nutrient => [nutrient, pick(nutrient)]),
  ) as NutrientStates;
}

// An ingredient: its main group full, the other nutrients it has some.
export function ingredientStates(
  mainGroup: FoodGroup | null,
  nutrients: Nutrient[],
): NutrientStates {
  return statesFrom(nutrient =>
    nutrient === mainGroup
      ? NutrientState.Full
      : nutrients.includes(nutrient)
      ? NutrientState.Some
      : NutrientState.None,
  );
}

// The nutrients a recipe's linked lines bring. Headings, unmatched and
// unlinked lines have no ingredient, so they don't count. Portion size is
// ignored in v1: a spoon of olive oil counts as healthy fat.
export function coveredNutrients(lines: RecipeLine[]): Set<Nutrient> {
  return new Set(lines.flatMap(line => line.ingredient?.nutrients ?? []));
}

// A recipe or meal: a nutrient it has is full, else none.
export function presentStates(nutrients: Iterable<Nutrient>): NutrientStates {
  const present = new Set(nutrients);
  return statesFrom(nutrient =>
    present.has(nutrient) ? NutrientState.Full : NutrientState.None,
  );
}

// A recipe: a nutrient any linked line has is full, else none.
export function recipeStates(lines: RecipeLine[]): NutrientStates {
  return presentStates(coveredNutrients(lines));
}

// The first nutrient not in `nutrients`, in dot order: what to add.
export function firstMissing(nutrients: Iterable<Nutrient>): Nutrient | null {
  const present = new Set(nutrients);
  return NUTRIENTS.find(nutrient => !present.has(nutrient)) ?? null;
}

// At or above this share of the week's meals a nutrient counts as full.
export const WEEK_FULL_SHARE = 0.5;

// A week: how many of its meals and attempts had the nutrient.
export function weekState(count: number, total: number): NutrientState {
  if (count <= 0 || total <= 0) return NutrientState.None;
  return count / total >= WEEK_FULL_SHARE
    ? NutrientState.Full
    : NutrientState.Some;
}

// The week's dots from its meals and attempts. Items with nothing to
// judge from (a photo-only meal: no nutrients known) don't count either way.
export function weekStates(
  items: { nutrients: Nutrient[]; judged: boolean }[],
): NutrientStates {
  const judged = items.filter(item => item.judged);
  return statesFrom(nutrient =>
    weekState(
      judged.filter(item => item.nutrients.includes(nutrient)).length,
      judged.length,
    ),
  );
}

// Everything eaten or cooked in a week, as weekStates items. A photo-only
// meal says nothing about nutrients, and neither does an attempt of a recipe
// with no linked lines, so those aren't judged.
export function weekItems(week: {
  meals: { nutrients: Nutrient[]; text: string | null }[];
  attempts: { nutrients: Nutrient[] }[];
}): WeekItem[] {
  return [...week.meals.map(mealItem), ...week.attempts.map(attemptItem)];
}

export type WeekItem = { nutrients: Nutrient[]; judged: boolean };

export function mealItem(meal: {
  nutrients: Nutrient[];
  text: string | null;
}): WeekItem {
  return { nutrients: meal.nutrients, judged: meal.text !== null };
}

export function attemptItem(attempt: { nutrients: Nutrient[] }): WeekItem {
  return {
    nutrients: attempt.nutrients,
    judged: attempt.nutrients.length > 0,
  };
}

export type Balance =
  | { kind: 'unknown' } // no linked lines: nothing to judge from
  | { kind: 'balanced' }
  | { kind: 'add'; nutrient: Nutrient }; // the first one not covered yet

export function recipeBalance(lines: RecipeLine[]): Balance {
  if (!lines.some(line => line.ingredient)) return { kind: 'unknown' };
  const covered = coveredNutrients(lines);
  const nutrient = NUTRIENTS.find(n => !covered.has(n));
  return nutrient ? { kind: 'add', nutrient } : { kind: 'balanced' };
}
