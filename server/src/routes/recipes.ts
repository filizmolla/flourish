import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { parsedRecipeCount } from "./imports.js";
import { buildMatcher, CATALOG_KEYS_SELECT, isHeadingLine, type Matcher } from "../catalog/matcher.js";

export const recipesRouter = Router();

const OPTIONAL_TEXT_FIELDS = ["story", "imageUrl", "source"] as const;

// "@account", "Mom", a cookbook: a short credit, not a note.
export const MAX_SOURCE_LENGTH = 100;
const OPTIONAL_INT_FIELDS = ["prepMinutes", "cookMinutes", "servings"] as const;

// Same rule as the mobile form (app/src/recipes/recipeForm.ts), so a link the
// form accepts is never rejected here. Deliberately a pattern rather than
// new URL(): React Native's URL support is incomplete, so the app can't match
// a stricter check.
const HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;

// Upper bound for minutes and servings: about a week in minutes, which fits
// long ferments, and keeps values well inside the database's 32-bit Int.
export const MAX_WHOLE_NUMBER = 10_000;

// Validates the optional detail fields; each may be omitted, null, or a valid value.
// Returns an error message, or the subset of fields present in the body.
function parseOptionalDetails(body: Record<string, unknown>) {
  const data: Record<string, string | number | null> = {};

  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") {
      return { error: `${field} must be a string or null` };
    }
    // A blank string means "no value", same as null.
    data[field] = value?.trim() || null;
  }

  if (typeof data.imageUrl === "string" && !HTTP_URL_PATTERN.test(data.imageUrl)) {
    return { error: "imageUrl must be an http(s) URL" };
  }
  if (typeof data.source === "string" && data.source.length > MAX_SOURCE_LENGTH) {
    return { error: `source must be at most ${MAX_SOURCE_LENGTH} characters` };
  }

  for (const field of OPTIONAL_INT_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (value !== null && (!Number.isInteger(value) || (value as number) < 0)) {
      return { error: `${field} must be a non-negative integer or null` };
    }
    if (value !== null && (value as number) > MAX_WHOLE_NUMBER) {
      return { error: `${field} must be at most ${MAX_WHOLE_NUMBER}` };
    }
    data[field] = value as number | null;
  }

  return { data };
}

// A recipe's ingredient lines in order (Phase 5: recipe_ingredient). The
// API still sends and takes `ingredients: string[]`; the old recipe.ingredients
// column is written alongside until a later migration drops it.
function linesInclude() {
  return {
    orderBy: { position: "asc" },
    select: { ...LINE_SELECT, ingredientId: true },
  } satisfies Prisma.Recipe$linesArgs;
}

// A line as the app sees it, in recipe responses and from the link route.
const LINE_SELECT = {
  position: true,
  text: true,
  linkSetByOwner: true,
  ingredient: { select: { id: true, name: true, mainGroup: true, nutrients: true } },
} satisfies Prisma.RecipeIngredientSelect;

type Line = { text: string; ingredientId: string | null; linkSetByOwner: boolean };

function lineTexts(lines: Line[]): string[] {
  return lines.map((line) => line.text);
}

async function loadMatcher(): Promise<Matcher> {
  return buildMatcher(await prisma.ingredient.findMany({ select: CATALOG_KEYS_SELECT }));
}

// New lines for a recipe. A line whose text is unchanged keeps its catalog
// link, even none, and whether the owner set it (each old line lends these
// once, in order), so editing one line doesn't relink the others; a new or
// changed line gets the matcher's pick.
function newLines(texts: string[], match: Matcher, previous: Line[] = []) {
  const unused = [...previous];
  return texts.map((text, position) => {
    const kept = unused.findIndex((line) => line.text === text);
    if (kept === -1) return { position, text, ingredientId: match(text), linkSetByOwner: false };
    const { ingredientId, linkSetByOwner } = unused.splice(kept, 1)[0];
    return { position, text, ingredientId, linkSetByOwner };
  });
}

// Every recipe response has the same shape (list, detail, create, update),
// because the app seeds its detail cache from the list and from saves.
const recipeInclude = {
  lines: linesInclude(),
  forkedFromRecipe: { select: { id: true, title: true } },
  forkedFromAttempt: { select: { id: true, madeAt: true } },
  forks: { select: { id: true, title: true }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.RecipeInclude;

type RecipeWithLinks = Prisma.RecipeGetPayload<{ include: typeof recipeInclude }>;

// forkedFrom is null once the original is gone: deleting it deletes its
// attempts, and both links are set to null.
function toRecipeResponse(recipe: RecipeWithLinks) {
  const { forkedFromRecipe, forkedFromAttempt, lines, ...rest } = recipe;
  return {
    ...rest,
    ingredients: lineTexts(lines),
    lines: lines.map(({ position, text, linkSetByOwner, ingredient }) => ({
      position,
      text,
      linkSetByOwner,
      ingredient,
    })),
    forkedFrom:
      forkedFromRecipe && forkedFromAttempt
        ? {
            id: forkedFromRecipe.id,
            title: forkedFromRecipe.title,
            attemptId: forkedFromAttempt.id,
            madeAt: forkedFromAttempt.madeAt,
          }
        : null,
  };
}

function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  // With the pg driver adapter the field only shows up in the index name
  // (meta.driverAdapterError.cause.constraint.index, e.g.
  // "recipe_forkedFromAttemptId_key"), so search the whole meta.
  return JSON.stringify(error.meta ?? {}).includes(field);
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

// Non-empty, trimmed lines; same as splitLines in app/src/recipes/recipeForm.ts.
function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Whether an attempt's version equals today's recipe, so forking it would
// only copy the recipe. A null snapshot means "same as today's recipe". This
// compares lines, not `tweaked`: after a recipe edit, an attempt cooked as-is
// holds the old lines, and forking is the way to get that version back.
function isSameAsRecipe(
  attempt: { ingredients: Prisma.JsonValue; instructions: string | null },
  recipe: { lines: Line[]; instructions: string },
): boolean {
  const ingredients = attempt.ingredients as { text: string }[] | null;
  const sameIngredients =
    ingredients === null ||
    sameLines(
      ingredients.map((line) => line.text),
      lineTexts(recipe.lines),
    );
  const sameInstructions =
    attempt.instructions === null ||
    sameLines(splitLines(attempt.instructions), splitLines(recipe.instructions));
  return sameIngredients && sameInstructions;
}

// Saving parsed recipe i means recipes 0..i are handled (saved or skipped),
// so reviewedCount moves up to i + 1, never down; once every parsed recipe
// is handled the import closes. Conditional updates rather than
// read-then-write, so two saves at once can't move the count backwards.
async function markImportReviewed(
  tx: Prisma.TransactionClient,
  { importId, importIndex, parsedCount }: { importId: string; importIndex: number; parsedCount: number },
) {
  await tx.recipeImport.updateMany({
    where: { id: importId, reviewedCount: { lt: importIndex + 1 } },
    data: { reviewedCount: importIndex + 1 },
  });
  await tx.recipeImport.updateMany({
    where: { id: importId, closedAt: null, reviewedCount: { gte: parsedCount } },
    data: { closedAt: new Date() },
  });
}

recipesRouter.use(requireAuth);

recipesRouter.get("/", async (req, res) => {
  const recipes = await prisma.recipe.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    include: recipeInclude,
  });
  res.json(recipes.map(toRecipeResponse));
});

recipesRouter.get("/:id", async (req, res) => {
  const recipe = await prisma.recipe.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: recipeInclude,
  });

  if (!recipe) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }

  res.json(toRecipeResponse(recipe));
});

recipesRouter.post("/", async (req, res) => {
  const { title, ingredients, instructions, forkedFromAttemptId, importId, importIndex } =
    req.body ?? {};

  if (typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (!Array.isArray(ingredients) || ingredients.some((i) => typeof i !== "string")) {
    res.status(400).json({ error: "ingredients must be an array of strings" });
    return;
  }
  if (typeof instructions !== "string") {
    res.status(400).json({ error: "instructions is required" });
    return;
  }

  const details = parseOptionalDetails(req.body);
  if (details.error) {
    res.status(400).json({ error: details.error });
    return;
  }

  // "Save as new recipe": the original recipe is taken from the attempt,
  // never from the client, so a fork can only point at the viewer's own recipe.
  let fork: { forkedFromAttemptId: string; forkedFromRecipeId: string } | null = null;
  if (forkedFromAttemptId !== undefined && forkedFromAttemptId !== null) {
    if (typeof forkedFromAttemptId !== "string" || !forkedFromAttemptId) {
      res.status(400).json({ error: "forkedFromAttemptId must be a string or null" });
      return;
    }
    const attempt = await prisma.attempt.findFirst({
      where: { id: forkedFromAttemptId, recipe: { userId: req.userId } },
      select: {
        id: true,
        recipeId: true,
        ingredients: true,
        instructions: true,
        fork: { select: { id: true } },
        recipe: { select: { lines: linesInclude(), instructions: true } },
      },
    });
    if (!attempt) {
      res.status(404).json({ error: "Attempt not found" });
      return;
    }
    if (attempt.fork) {
      res.status(409).json({ error: "This attempt was already saved as a recipe" });
      return;
    }
    if (isSameAsRecipe(attempt, attempt.recipe)) {
      res
        .status(409)
        .json({ error: "This attempt is the same as the recipe, so there is nothing to save" });
      return;
    }
    fork = { forkedFromAttemptId: attempt.id, forkedFromRecipeId: attempt.recipeId };
  }

  // A recipe saved from a photo import: which parsed recipe of which import.
  // Both or neither; the import must be the viewer's own.
  let fromImport: { importId: string; importIndex: number; parsedCount: number } | null = null;
  const hasImportId = importId !== undefined && importId !== null;
  const hasImportIndex = importIndex !== undefined && importIndex !== null;
  if (hasImportId || hasImportIndex) {
    if (!hasImportId || !hasImportIndex) {
      res.status(400).json({ error: "importId and importIndex must be sent together" });
      return;
    }
    if (typeof importId !== "string" || !importId) {
      res.status(400).json({ error: "importId must be a string or null" });
      return;
    }
    if (!Number.isInteger(importIndex) || importIndex < 0) {
      res.status(400).json({ error: "importIndex must be a non-negative integer or null" });
      return;
    }
    if (fork) {
      res.status(400).json({ error: "A recipe can't come from both an attempt and an import" });
      return;
    }
    const recipeImport = await prisma.recipeImport.findFirst({
      where: { id: importId, userId: req.userId },
      select: { result: true },
    });
    if (!recipeImport) {
      res.status(404).json({ error: "Import not found" });
      return;
    }
    const parsedCount = parsedRecipeCount(recipeImport.result);
    // NO_RECIPE, FAILED or still PENDING.
    if (parsedCount === 0) {
      res.status(400).json({ error: "This import has no recipes to save" });
      return;
    }
    if (importIndex >= parsedCount) {
      res.status(400).json({ error: `importIndex must be below ${parsedCount}` });
      return;
    }
    fromImport = { importId, importIndex, parsedCount };
  }

  const match = await loadMatcher();

  try {
    const recipe = await prisma.$transaction(async (tx) => {
      const created = await tx.recipe.create({
        data: {
          title: title.trim(),
          ingredients,
          lines: { create: newLines(ingredients, match) },
          instructions,
          ...details.data,
          ...fork,
          ...(fromImport && { importId: fromImport.importId, importIndex: fromImport.importIndex }),
          userId: req.userId!,
        },
        include: recipeInclude,
      });
      if (fromImport) await markImportReviewed(tx, fromImport);
      return created;
    });
    res.status(201).json(toRecipeResponse(recipe));
  } catch (error) {
    // Two saves of the same attempt can both pass the check above; the
    // unique constraint on forkedFromAttemptId stops the second one.
    if (fork && isUniqueViolationOn(error, "forkedFromAttemptId")) {
      res.status(409).json({ error: "This attempt was already saved as a recipe" });
      return;
    }
    // Same for a parsed recipe: @@unique([importId, importIndex]).
    if (fromImport && isUniqueViolationOn(error, "importId")) {
      res.status(409).json({ error: "This recipe from the import was already saved" });
      return;
    }
    throw error;
  }
});

recipesRouter.patch("/:id", async (req, res) => {
  const existing = await prisma.recipe.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { lines: linesInclude() },
  });

  if (!existing) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }

  const { title, ingredients, instructions } = req.body ?? {};

  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    res.status(400).json({ error: "title must be a non-empty string" });
    return;
  }
  if (
    ingredients !== undefined &&
    (!Array.isArray(ingredients) || ingredients.some((i) => typeof i !== "string"))
  ) {
    res.status(400).json({ error: "ingredients must be an array of strings" });
    return;
  }
  if (instructions !== undefined && typeof instructions !== "string") {
    res.status(400).json({ error: "instructions must be a string" });
    return;
  }

  const details = parseOptionalDetails(req.body ?? {});
  if (details.error) {
    res.status(400).json({ error: details.error });
    return;
  }

  // The form sends every field on each save, so "changed" means the value
  // differs from the stored one, not that the field was sent.
  const ingredientsChanged =
    ingredients !== undefined && !sameLines(ingredients, lineTexts(existing.lines));
  const instructionsChanged =
    instructions !== undefined && instructions !== existing.instructions;

  const match = ingredientsChanged ? await loadMatcher() : null;

  const recipe = await prisma.$transaction(async (tx) => {
    // Honest history: an attempt's null snapshot means "same as today's
    // recipe", so before the recipe changes, attempts cooked from the old
    // version get that version written in. Each field on its own.
    if (match) {
      await tx.attempt.updateMany({
        where: { recipeId: existing.id, ingredients: { equals: Prisma.DbNull } },
        // Attempt snapshots are `{ text, ingredientId? }` lines.
        data: {
          ingredients: existing.lines.map(({ text, ingredientId }) =>
            ingredientId ? { text, ingredientId } : { text },
          ),
        },
      });
      await tx.recipeIngredient.deleteMany({ where: { recipeId: existing.id } });
      await tx.recipeIngredient.createMany({
        data: newLines(ingredients, match, existing.lines).map((line) => ({
          ...line,
          recipeId: existing.id,
        })),
      });
    }
    if (instructionsChanged) {
      await tx.attempt.updateMany({
        where: { recipeId: existing.id, instructions: null },
        data: { instructions: existing.instructions },
      });
    }

    return tx.recipe.update({
      where: { id: existing.id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(ingredientsChanged && { ingredients }),
        ...(instructions !== undefined && { instructions }),
        ...details.data,
      },
      include: recipeInclude,
    });
  });

  res.json(toRecipeResponse(recipe));
});

// The owner fixes a line's catalog link: { ingredientId: "<id>" } links it
// to that entry, { ingredientId: null } unlinks it. Either way the line is
// marked as set by the owner, so the matcher never changes it again (until
// its text is edited). Lines are addressed by position, since the API has no
// line ids and a recipe edit recreates the rows.
recipesRouter.patch("/:id/lines/:position", async (req, res) => {
  const position = Number(req.params.position);
  if (!/^\d+$/.test(req.params.position) || !Number.isSafeInteger(position)) {
    res.status(400).json({ error: "position must be a non-negative integer" });
    return;
  }

  const { ingredientId } = req.body ?? {};
  if (ingredientId !== null && (typeof ingredientId !== "string" || !ingredientId)) {
    res.status(400).json({ error: "ingredientId must be a string or null" });
    return;
  }

  // Scoped by userId: someone else's recipe is a 404, same as a missing one.
  const line = await prisma.recipeIngredient.findFirst({
    where: { recipe: { id: req.params.id, userId: req.userId }, position },
    select: { id: true, text: true },
  });
  if (!line) {
    const recipe = await prisma.recipe.findFirst({
      where: { id: req.params.id, userId: req.userId },
      select: { id: true },
    });
    res.status(404).json({ error: recipe ? "Line not found" : "Recipe not found" });
    return;
  }

  if (ingredientId !== null) {
    if (isHeadingLine(line.text)) {
      res.status(400).json({ error: "A section heading can't be linked" });
      return;
    }
    const ingredient = await prisma.ingredient.findUnique({ where: { id: ingredientId }, select: { id: true } });
    if (!ingredient) {
      res.status(400).json({ error: "ingredientId is not in the catalog" });
      return;
    }
  }

  const updated = await prisma.recipeIngredient.update({
    where: { id: line.id },
    data: { ingredientId, linkSetByOwner: true },
    select: LINE_SELECT,
  });
  res.json(updated);
});

recipesRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.recipe.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });

  if (!existing) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }

  await prisma.recipe.delete({ where: { id: existing.id } });
  res.status(204).send();
});
