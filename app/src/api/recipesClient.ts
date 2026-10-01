import { API_BASE_URL } from '../config';
import { strings } from '../strings';

export type Recipe = {
  id: string;
  title: string;
  ingredients: string[];
  // The same lines with their catalog links (Phase 6), read-only here:
  // writes still send `ingredients`.
  lines: RecipeLine[];
  instructions: string;
  story: string | null;
  imageUrl: string | null;
  // Who it's from: "@account", "Mom", a cookbook.
  source: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: number | null;
  // "Save as new recipe": where this recipe came from (null once the original
  // is deleted), and the recipes saved from this one's attempts, newest first.
  forkedFrom: {
    id: string;
    title: string;
    attemptId: string;
    madeAt: string;
  } | null;
  forks: { id: string; title: string }[];
  createdAt: string;
  updatedAt: string;
};

// ingredient: the catalog entry the line is linked to; null for a `# `
// heading, an unmatched line, or one the owner unlinked (linkSetByOwner).
export type RecipeLine = {
  position: number;
  text: string;
  linkSetByOwner: boolean;
  ingredient: IngredientSummary | null;
};

// The writable fields, as sent to POST (all) and PATCH (any subset).
export type RecipeInput = Pick<
  Recipe,
  | 'title'
  | 'ingredients'
  | 'instructions'
  | 'story'
  | 'imageUrl'
  | 'source'
  | 'prepMinutes'
  | 'cookMinutes'
  | 'servings'
>;

export class RecipesError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return (
      body?.message ??
      body?.error ??
      strings.common.requestFailed(response.status)
    );
  } catch {
    return strings.common.requestFailed(response.status);
  }
}

async function request<T>(
  token: string,
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'omit',
    signal: init.signal,
  });

  if (!response.ok) {
    throw new RecipesError(await parseError(response), response.status);
  }

  // DELETE answers 204 with no body.
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export function fetchRecipes(token: string): Promise<Recipe[]> {
  return request(token, '/recipes');
}

export function fetchRecipe(token: string, id: string): Promise<Recipe> {
  return request(token, `/recipes/${encodeURIComponent(id)}`);
}

// forkedFromAttemptId saves an attempt's version as a new, linked recipe.
// importId + importIndex (both or neither) save one recipe read from photos.
export type CreateRecipeInput = RecipeInput & {
  forkedFromAttemptId?: string;
  importId?: string;
  importIndex?: number;
};

export function createRecipe(
  token: string,
  input: CreateRecipeInput,
): Promise<Recipe> {
  return request(token, '/recipes', { method: 'POST', body: input });
}

export function updateRecipe(
  token: string,
  id: string,
  input: Partial<RecipeInput>,
): Promise<Recipe> {
  return request(token, `/recipes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
}

export function deleteRecipe(token: string, id: string): Promise<void> {
  return request(token, `/recipes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// One time you cooked a recipe. ingredients/instructions are null when they
// match the recipe as it is today, else the full list as cooked. tweaked:
// lines were changed while cooking (the "changed" badge).
export type Attempt = {
  id: string;
  recipeId: string;
  durationMinutes: number | null;
  madeAt: string;
  rating: number | null;
  // "How did you feel after?", asked with the rating.
  fullness: Fullness | null;
  // "Was it enjoyable to make?": the effort, apart from the taste.
  enjoyment: Enjoyment | null;
  // A photo of what came out, taken at Finish: attemptPhotoUrl(id).
  hasPhoto: boolean;
  notes: string | null;
  ingredients: { text: string; ingredientId?: string }[] | null;
  instructions: string | null;
  basedOnAttemptId: string | null;
  tweaked: boolean;
  createdAt: string;
  updatedAt: string;
};

// photo: one JPEG or PNG in base64, only at Finish.
export type AttemptInput = Pick<
  Attempt,
  | 'durationMinutes'
  | 'rating'
  | 'fullness'
  | 'enjoyment'
  | 'notes'
  | 'ingredients'
  | 'instructions'
  | 'basedOnAttemptId'
> & { photo?: string };

export function createAttempt(
  token: string,
  recipeId: string,
  input: AttemptInput,
): Promise<Attempt> {
  return request(token, `/recipes/${encodeURIComponent(recipeId)}/attempts`, {
    method: 'POST',
    body: input,
  });
}

// Newest first.
export function fetchAttempts(
  token: string,
  recipeId: string,
): Promise<Attempt[]> {
  return request(token, `/recipes/${encodeURIComponent(recipeId)}/attempts`);
}

// One attempt, plus enough of the attempt it was based on for a link.
// fork: the recipe saved from this attempt, if any.
export type AttemptDetail = Attempt & {
  basedOnAttempt: { id: string; madeAt: string } | null;
  fork: { id: string; title: string } | null;
};

export function fetchAttempt(
  token: string,
  id: string,
): Promise<AttemptDetail> {
  return request(token, `/attempts/${encodeURIComponent(id)}`);
}

// Rate later: only rating and notes change after Finish. Omitted = left as
// is; null = cleared.
export type AttemptUpdate = Partial<
  Pick<Attempt, 'rating' | 'fullness' | 'enjoyment' | 'notes'>
>;

export function updateAttempt(
  token: string,
  id: string,
  input: AttemptUpdate,
): Promise<AttemptDetail> {
  return request(token, `/attempts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
}

// The newest attempt from the last 48 h without a rating, for the rate prompt
// card on the recipe list.
export type UnratedAttempt = Attempt & {
  recipe: { id: string; title: string };
};

export function fetchUnratedAttempt(
  token: string,
): Promise<UnratedAttempt | null> {
  return request(token, '/attempts?unrated=true');
}

// One recipe the model read from the photos, shaped like the form's fields:
// one step per line in instructions. title is '' when the photos had none.
// source: '' when the photos credit no one; missing on imports read before
// the field existed.
export type ParsedRecipe = Pick<
  Recipe,
  'title' | 'ingredients' | 'instructions'
> & { source?: string };

export type ParsedImport = { importId: string; recipes: ParsedRecipe[] };

// images: base64 JPEG or PNG, no data-URL prefix, in the order added. An empty
// recipes list means no recipe was found. signal: Cancel while reading.
export function parseImport(
  token: string,
  images: string[],
  signal?: AbortSignal,
): Promise<ParsedImport> {
  return request(token, '/imports/parse', {
    method: 'POST',
    body: { images },
    signal,
  });
}

// Skip: reviewedCount moves past a recipe without saving it. closed: Stop
// importing. The server closes the import itself once every recipe is handled.
export type ImportUpdate = { reviewedCount: number } | { closed: true };

// recipe_import.status on the server (Prisma enum ImportStatus).
export enum ImportStatus {
  Pending = 'PENDING',
  Done = 'DONE',
  NoRecipe = 'NO_RECIPE',
  Failed = 'FAILED',
}

export type ImportState = {
  id: string;
  status: ImportStatus;
  reviewedCount: number;
  closedAt: string | null;
};

export function updateImport(
  token: string,
  id: string,
  input: ImportUpdate,
): Promise<ImportState> {
  return request(token, `/imports/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
}

// The ingredient catalog (Phase 5): global and read-only. Values match the
// server's Prisma enum FoodGroup; a nutrient is any of them but CARB.
export enum FoodGroup {
  Protein = 'PROTEIN',
  Fiber = 'FIBER',
  HealthyFat = 'HEALTHY_FAT',
  Carb = 'CARB',
}

export type Nutrient = Exclude<FoodGroup, FoodGroup.Carb>;

// mainGroup null: a seasoning, or anything that doesn't count toward a
// balanced plate. nutrients includes the main group when it's a nutrient.
export type IngredientSummary = {
  id: string;
  name: string;
  mainGroup: FoodGroup | null;
  nutrients: Nutrient[];
};

// q: part of a name or alias (Turkish too). group: a nutrient matches any
// ingredient that has it; CARB matches the main group.
export type IngredientFilters = { q?: string; group?: FoodGroup };

export function fetchIngredients(
  token: string,
  { q, group }: IngredientFilters = {},
): Promise<IngredientSummary[]> {
  // Built by hand: React Native's URLSearchParams is incomplete.
  const params = [
    ...(q ? [`q=${encodeURIComponent(q)}`] : []),
    ...(group ? [`group=${group}`] : []),
  ];
  return request(
    token,
    `/ingredients${params.length ? `?${params.join('&')}` : ''}`,
  );
}

// One catalog entry, plus the viewer's recipes with a line linked to it.
// fdcId: the food's USDA FoodData Central id, when it has one.
export type IngredientDetail = IngredientSummary & {
  description: string | null;
  fdcId: number | null;
  recipes: { id: string; title: string }[];
};

export function fetchIngredient(
  token: string,
  id: string,
): Promise<IngredientDetail> {
  return request(token, `/ingredients/${encodeURIComponent(id)}`);
}

// The food's page on USDA FoodData Central, where its values come from.
export function usdaFoodUrl(fdcId: number): string {
  return `https://fdc.nal.usda.gov/food-details/${fdcId}`;
}

// Phase 6: a meal or snack eaten anywhere, logged with an optional photo,
// text and "How did you feel after?". Values match the server's enums.
export enum MealKind {
  Meal = 'MEAL',
  Snack = 'SNACK',
}

// "Was it enjoyable to make?" Values match the server's enum.
export enum Enjoyment {
  Loved = 'LOVED',
  Fine = 'FINE',
  NotWorthIt = 'NOT_WORTH_IT',
}

// None of these is the "right" answer.
export enum Fullness {
  StillHungry = 'STILL_HUNGRY',
  Satisfied = 'SATISFIED',
  VeryFull = 'VERY_FULL',
}

// nutrients: what the foods in `text` bring, worked out by the server when
// the text is saved. hasPhoto: fetch it from mealPhotoUrl(id).
export type Meal = {
  id: string;
  kind: MealKind;
  eatenAt: string;
  text: string | null;
  nutrients: Nutrient[];
  fullness: Fullness | null;
  hasPhoto: boolean;
  createdAt: string;
  updatedAt: string;
};

// photo: one JPEG or PNG in base64. A meal needs a photo or text.
export type MealInput = {
  kind: MealKind;
  eatenAt?: string;
  text?: string | null;
  fullness?: Fullness | null;
  photo?: string;
};

export function createMeal(token: string, input: MealInput): Promise<Meal> {
  return request(token, '/meals', { method: 'POST', body: input });
}

// Omitted = left as is; null = cleared. New text recomputes the nutrients.
// The photo can't be changed.
export type MealUpdate = Partial<
  Pick<Meal, 'kind' | 'eatenAt' | 'text' | 'fullness'>
>;

export function updateMeal(
  token: string,
  id: string,
  input: MealUpdate,
): Promise<Meal> {
  return request(token, `/meals/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
}

// Removes the meal and its photo.
export function deleteMeal(token: string, id: string): Promise<void> {
  return request(token, `/meals/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// The viewer's last distinct snack texts, newest first.
export function fetchRecentSnacks(token: string): Promise<string[]> {
  return request(token, '/meals/recent-snacks');
}

// Needs the Authorization header, like every other route.
export function mealPhotoUrl(id: string): string {
  return `${API_BASE_URL}/meals/${encodeURIComponent(id)}/photo`;
}

// A cooked attempt in Your week. nutrients: what the recipe's linked lines
// bring today.
export type WeekAttempt = {
  id: string;
  recipeId: string;
  madeAt: string;
  rating: number | null;
  fullness: Fullness | null;
  hasPhoto: boolean;
  recipe: { id: string; title: string; imageUrl: string | null };
  nutrients: Nutrient[];
};

export type Week = { meals: Meal[]; attempts: WeekAttempt[] };

// from/to: the week's bounds in the phone's time zone (Monday to Monday).
export function fetchWeek(token: string, from: Date, to: Date): Promise<Week> {
  return request(
    token,
    `/week?from=${encodeURIComponent(
      from.toISOString(),
    )}&to=${encodeURIComponent(to.toISOString())}`,
  );
}

// Needs the Authorization header, like every other route.
export function attemptPhotoUrl(id: string): string {
  return `${API_BASE_URL}/attempts/${encodeURIComponent(id)}/photo`;
}
