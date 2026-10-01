import { Recipe } from '../api/recipesClient';

// The recipe list's search and filters, applied on the phone: the whole list
// is already loaded, and a person's recipe box is small.

// "At most this many minutes" (prep + cook); null = any time.
export const TIME_FILTERS = [15, 30, 60] as const;
export type TimeFilter = (typeof TIME_FILTERS)[number];

export type RecipeFilters = {
  query: string;
  maxMinutes: TimeFilter | null;
  // A source key from sourceOptions; null = from anywhere.
  source: string | null;
};

export const NO_FILTERS: RecipeFilters = {
  query: '',
  maxMinutes: null,
  source: null,
};

// Lower case the Turkish way, then ı → i, so "İSPANAK", "ıspanak" and
// "Ispanak" match each other, and an English "I" still matches "i".
export function foldForSearch(text: string): string {
  return text.toLocaleLowerCase('tr').replace(/ı/g, 'i').trim();
}

export function hasFilters(filters: RecipeFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.maxMinutes !== null ||
    filters.source !== null
  );
}

function totalMinutes(recipe: Recipe): number | null {
  const total = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
  return total > 0 ? total : null;
}

// Every word of the query must appear in the title or in an ingredient line
// ("chickpea spinach" finds the curry with both).
function matchesQuery(recipe: Recipe, query: string): boolean {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [recipe.title, ...recipe.ingredients]
    .map(foldForSearch)
    .join('\n');
  return words.every(word => haystack.includes(word));
}

export function filterRecipes(
  recipes: Recipe[],
  filters: RecipeFilters,
): Recipe[] {
  return recipes.filter(recipe => {
    if (!matchesQuery(recipe, filters.query)) return false;
    if (filters.maxMinutes !== null) {
      // A time filter can't vouch for a recipe with no times.
      const minutes = totalMinutes(recipe);
      if (minutes === null || minutes > filters.maxMinutes) return false;
    }
    if (filters.source !== null) {
      if (!recipe.source || foldForSearch(recipe.source) !== filters.source) {
        return false;
      }
    }
    return true;
  });
}

// The "From" chips: each distinct source once, whatever its case ("Mom" and
// "mom" are one chip, labelled as most recipes write it), A to Z.
export function sourceOptions(
  recipes: Recipe[],
): { key: string; label: string }[] {
  const spellings = new Map<string, Map<string, number>>();
  for (const recipe of recipes) {
    const source = recipe.source?.trim();
    if (!source) continue;
    const key = foldForSearch(source);
    const counts = spellings.get(key) ?? new Map<string, number>();
    counts.set(source, (counts.get(source) ?? 0) + 1);
    spellings.set(key, counts);
  }
  return [...spellings.entries()]
    .map(([key, counts]) => ({
      key,
      label: [...counts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0][0],
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'));
}
