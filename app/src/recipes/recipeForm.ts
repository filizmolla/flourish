import { z } from 'zod';
import {
  AttemptDetail,
  ParsedRecipe,
  Recipe,
  RecipeInput,
} from '../api/recipesClient';
import { strings } from '../strings';

// Matches the server's limit (server/src/routes/recipes.ts).
export const MAX_WHOLE_NUMBER = 10_000;

// Blank, or a whole number up to MAX_WHOLE_NUMBER. Kept as a string in the
// form because TextInput only deals in strings; converted in toRecipeInput.
const optionalWholeNumber = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d*$/, strings.validation.wholeNumber(label))
    .refine(value => value === '' || Number(value) <= MAX_WHOLE_NUMBER, {
      message: strings.validation.atMost(label, MAX_WHOLE_NUMBER),
    });

// At least one line that isn't a heading: headings alone don't make a recipe.
function requiredLines(required: string, onlyHeadings: string) {
  return z.string().superRefine((value, ctx) => {
    const lines = splitLines(value);
    if (lines.some(line => !isHeadingLine(line))) return;
    ctx.addIssue({
      code: 'custom',
      message: lines.length === 0 ? required : onlyHeadings,
    });
  });
}

// Matches the server's limit (server/src/routes/recipes.ts).
export const MAX_SOURCE_LENGTH = 100;

// Same rule as the server, so a link accepted here is never rejected there.
const HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;

// Every field is a string, as typed. Ingredients and instructions are
// one-per-line text areas rather than dynamic lists, which keeps the form
// simple and makes pasting a recipe from elsewhere painless.
export const recipeFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, strings.validation.titleRequired)
    .max(200, strings.validation.titleTooLong),
  story: z.string(),
  source: z
    .string()
    .trim()
    .max(MAX_SOURCE_LENGTH, strings.validation.sourceTooLong),
  imageUrl: z
    .string()
    .trim()
    .refine(value => value === '' || HTTP_URL_PATTERN.test(value), {
      message: strings.validation.imageUrlInvalid,
    }),
  prepMinutes: optionalWholeNumber(strings.validation.prepTime),
  cookMinutes: optionalWholeNumber(strings.validation.cookTime),
  servings: optionalWholeNumber(strings.validation.servings),
  ingredients: requiredLines(
    strings.validation.ingredientsRequired,
    strings.validation.ingredientsOnlyHeadings,
  ),
  instructions: requiredLines(
    strings.validation.instructionsRequired,
    strings.validation.instructionsOnlyHeadings,
  ),
});

export type RecipeFormValues = z.infer<typeof recipeFormSchema>;

export const emptyRecipeForm: RecipeFormValues = {
  title: '',
  story: '',
  source: '',
  imageUrl: '',
  prepMinutes: '',
  cookMinutes: '',
  servings: '',
  ingredients: '',
  instructions: '',
};

// Non-empty, trimmed lines. Used for ingredients and instruction steps, both
// in the form and when displaying a recipe.
export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

// A section heading inside ingredients or steps ("# For the cream"): shown
// as a subhead, never checked, counted or numbered. The space after # is
// required, so "#hashtag" and "#10 can" stay ordinary lines.
const HEADING_PATTERN = /^#+\s+(\S.*)$/;

export function isHeadingLine(line: string): boolean {
  return HEADING_PATTERN.test(line.trim());
}

// The heading as shown, without its #; any other line as it is.
export function headingText(line: string): string {
  return line.trim().match(HEADING_PATTERN)?.[1].trim() ?? line;
}

function toOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : Number(trimmed);
}

export function toFormValues(recipe: Recipe): RecipeFormValues {
  return {
    title: recipe.title,
    story: recipe.story ?? '',
    source: recipe.source ?? '',
    imageUrl: recipe.imageUrl ?? '',
    prepMinutes: recipe.prepMinutes?.toString() ?? '',
    cookMinutes: recipe.cookMinutes?.toString() ?? '',
    servings: recipe.servings?.toString() ?? '',
    ingredients: recipe.ingredients.join('\n'),
    instructions: recipe.instructions,
  };
}

// "Save as new recipe": the version cooked in that attempt (a null snapshot
// means today's recipe), with the recipe's times, servings, photo and source.
// Title and story start empty: the new recipe gets its own name and story.
export function toForkFormValues(
  recipe: Recipe,
  attempt: AttemptDetail,
): RecipeFormValues {
  return {
    ...toFormValues(recipe),
    title: '',
    story: '',
    ingredients: (
      attempt.ingredients?.map(line => line.text) ?? recipe.ingredients
    ).join('\n'),
    instructions: attempt.instructions ?? recipe.instructions,
  };
}

// A recipe read from photos: title, source, ingredients and steps as the
// model read them; times, servings, photo and story start empty.
export function fromParsedRecipe(recipe: ParsedRecipe): RecipeFormValues {
  return {
    ...emptyRecipeForm,
    title: recipe.title,
    source: recipe.source ?? '',
    ingredients: recipe.ingredients.join('\n'),
    instructions: recipe.instructions,
  };
}

// Expects values that already passed recipeFormSchema.
export function toRecipeInput(values: RecipeFormValues): RecipeInput {
  return {
    title: values.title.trim(),
    story: values.story.trim() || null,
    source: values.source.trim() || null,
    imageUrl: values.imageUrl.trim() || null,
    prepMinutes: toOptionalNumber(values.prepMinutes),
    cookMinutes: toOptionalNumber(values.cookMinutes),
    servings: toOptionalNumber(values.servings),
    ingredients: splitLines(values.ingredients),
    instructions: splitLines(values.instructions).join('\n'),
  };
}
