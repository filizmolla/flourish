import { Nutrient, Recipe } from '../api/recipesClient';
import {
  coveredNutrients,
  NUTRIENTS,
  NutrientState,
  NutrientStates,
} from './nutrientStates';

// "How much time do you have?": 15 min, 30 min, or an hour or more (no limit).
export const TIME_CHOICES = [15, 30, 60] as const;
export type TimeChoice = (typeof TIME_CHOICES)[number];
export const NO_LIMIT: TimeChoice = 60;

export type Suggestion = {
  recipe: Recipe;
  // Prep + cook; null when the recipe gives neither.
  minutes: number | null;
  // What it brings that this week is short on, if anything, and how short:
  // None = not had at all this week, Some = had only a few times.
  adds: { nutrient: Nutrient; week: NutrientState } | null;
};

// The week's gaps, the grayest first: nutrients not had yet, then ones had
// only a few times. A full dot is no gap.
function weekGaps(week: NutrientStates | null): Nutrient[] {
  if (!week) return [];
  return [
    ...NUTRIENTS.filter(n => week[n] === NutrientState.None),
    ...NUTRIENTS.filter(n => week[n] === NutrientState.Some),
  ];
}

function addsFor(
  nutrient: Nutrient | undefined,
  week: NutrientStates | null,
): Suggestion['adds'] {
  return nutrient && week ? { nutrient, week: week[nutrient] } : null;
}

// The viewer's recipes that fit in `limit` minutes, the ones that add what
// this week is short on first, then the quickest. Recipes without times
// can't be judged against the clock, so they come last rather than not at
// all. `week` is null while it loads: then nothing is marked as adding.
export function suggestRecipes(
  recipes: Recipe[],
  limit: TimeChoice,
  week: NutrientStates | null,
): Suggestion[] {
  const gaps = weekGaps(week);
  return recipes
    .map(recipe => {
      const total = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
      const covered = coveredNutrients(recipe.lines);
      return {
        recipe,
        minutes: total > 0 ? total : null,
        adds: addsFor(
          gaps.find(n => covered.has(n)),
          week,
        ),
      };
    })
    .filter(
      ({ minutes }) =>
        limit === NO_LIMIT || minutes === null || minutes <= limit,
    )
    .sort((a, b) => {
      const untimed = Number(a.minutes === null) - Number(b.minutes === null);
      if (untimed) return untimed;
      const rank = (s: Suggestion) =>
        s.adds === null ? gaps.length : gaps.indexOf(s.adds.nutrient);
      const adds = rank(a) - rank(b);
      if (adds) return adds;
      const quicker = (a.minutes ?? 0) - (b.minutes ?? 0);
      if (quicker) return quicker;
      return a.recipe.title.localeCompare(b.recipe.title);
    });
}
