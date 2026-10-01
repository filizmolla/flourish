import express, { Router } from "express";
import path from "node:path";
import { z } from "zod";
import { Enjoyment, Fullness, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { MAX_WHOLE_NUMBER } from "./recipes.js";
import { getStorageDir, readImageInfo, writeRowPhoto } from "../importPhotos.js";

// A photo from the phone, shrunk like import and meal photos.
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const ATTEMPT_BODY_LIMIT = "4mb";

// Attempts have no userId: every query goes through the recipe's owner, so
// another user's recipe or attempt is a 404, never a 403.

// One ingredient line; same shape as the Phase 5 recipe_ingredient line.
const ingredientLineSchema = z.strictObject({
  text: z.string().trim().min(1, "ingredient text must not be empty"),
  ingredientId: z.string().min(1).optional(),
});

// A blank string means "no notes", same as null.
const optionalNotes = z
  .string()
  .trim()
  .transform((value) => value || null)
  .nullable()
  .optional();

const createAttemptSchema = z.strictObject({
  durationMinutes: z.int().min(0).max(MAX_WHOLE_NUMBER).nullable().optional(),
  rating: z.int().min(1).max(5).nullable().optional(),
  // "How did you feel after?", asked with the rating.
  fullness: z.enum(Fullness).nullable().optional(),
  // "Was it enjoyable to make?"
  enjoyment: z.enum(Enjoyment).nullable().optional(),
  notes: optionalNotes,
  // What came out: one JPEG or PNG in base64, only at Finish.
  photo: z.string().regex(BASE64_PATTERN, "photo must be a base64 string").optional(),
  // null or omitted = unchanged from the base recipe; else a full snapshot.
  ingredients: z.array(ingredientLineSchema).nullable().optional(),
  instructions: z.string().nullable().optional(),
  basedOnAttemptId: z.string().min(1).nullable().optional(),
});

// Rate later: only the rating, fullness, enjoyment and notes can change
// after Finish. Snapshots
// are rejected (strict), so an attempt stays a record of what was cooked.
// Omitted = left as is; null = cleared.
const updateAttemptSchema = z.strictObject({
  rating: z.int().min(1).max(5).nullable().optional(),
  fullness: z.enum(Fullness).nullable().optional(),
  enjoyment: z.enum(Enjoyment).nullable().optional(),
  notes: optionalNotes,
});

// Attempt detail: enough for the "Based on Sep 21" link and for
// "Saved as Spicy Shakshuka" once the attempt was saved as a recipe.
const attemptDetailInclude = {
  basedOnAttempt: { select: { id: true, madeAt: true } },
  fork: { select: { id: true, title: true } },
} satisfies Prisma.AttemptInclude;

// How far back the rate prompt card looks for an unrated attempt.
const UNRATED_WINDOW_MS = 48 * 60 * 60 * 1000;


// The disk path stays on the server; the app asks GET /attempts/:id/photo.
export function toAttemptResponse<T extends { photoPath: string | null }>({ photoPath, ...attempt }: T) {
  return { ...attempt, hasPhoto: photoPath !== null };
}

// "rating: Too big: expected number to be <=5"
function formatZodError(error: z.ZodError) {
  const issue = error.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

// Mounted at /recipes/:recipeId/attempts.
// Mounted before the global express.json() in app.ts, so a Finish with a
// photo gets its own body limit; auth runs first.
export const recipeAttemptsRouter = Router({ mergeParams: true });
recipeAttemptsRouter.use(requireAuth);
recipeAttemptsRouter.use(express.json({ limit: ATTEMPT_BODY_LIMIT }));

async function findOwnedRecipe(recipeId: string, userId: string) {
  return prisma.recipe.findFirst({ where: { id: recipeId, userId }, select: { id: true } });
}

recipeAttemptsRouter.get("/", async (req, res) => {
  const { recipeId } = req.params as { recipeId: string };
  const recipe = await findOwnedRecipe(recipeId, req.userId!);

  if (!recipe) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }

  const attempts = await prisma.attempt.findMany({
    where: { recipeId: recipe.id },
    orderBy: { madeAt: "desc" },
  });
  res.json(attempts.map(toAttemptResponse));
});

recipeAttemptsRouter.post("/", async (req, res) => {
  const { recipeId } = req.params as { recipeId: string };
  const recipe = await findOwnedRecipe(recipeId, req.userId!);

  if (!recipe) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }

  const parsed = createAttemptSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const { ingredients, basedOnAttemptId, photo, ...rest } = parsed.data;

  const photoData = photo ? Buffer.from(photo, "base64") : null;
  const photoInfo = photoData ? readImageInfo(photoData) : null;
  if (photoData && !photoInfo) {
    res.status(400).json({ error: "photo is not a JPEG or PNG" });
    return;
  }
  const storageDir = photoData ? getStorageDir() : null;
  if (photoData && !storageDir) {
    throw new Error("STORAGE_DIR must be set to keep attempt photos");
  }

  if (basedOnAttemptId) {
    const base = await prisma.attempt.findFirst({
      where: { id: basedOnAttemptId, recipeId: recipe.id },
      select: { id: true },
    });
    if (!base) {
      res.status(400).json({ error: "basedOnAttemptId must be an attempt of this recipe" });
      return;
    }
  }

  const attempt = await prisma.attempt.create({
    data: {
      ...rest,
      // A JSON column needs Prisma.DbNull to store SQL NULL rather than JSON null.
      ingredients: ingredients ?? Prisma.DbNull,
      basedOnAttemptId: basedOnAttemptId ?? null,
      // Snapshots sent at Finish mean lines were changed while cooking.
      // Later recipe edits fill in null snapshots but never touch this.
      tweaked: ingredients != null || rest.instructions != null,
      recipeId: recipe.id,
    },
  });

  if (!photoData || !photoInfo || !storageDir) {
    res.status(201).json(toAttemptResponse(attempt));
    return;
  }

  // The row first, so the file is named after it; a failed write removes the
  // row again rather than leave an attempt with a missing photo.
  let photoPath: string;
  try {
    photoPath = await writeRowPhoto(storageDir, "attempts", req.userId!, attempt.id, {
      data: photoData,
      mimeType: photoInfo.mimeType,
    });
  } catch (error) {
    await prisma.attempt.delete({ where: { id: attempt.id } });
    throw error;
  }
  const saved = await prisma.attempt.update({ where: { id: attempt.id }, data: { photoPath } });
  res.status(201).json(toAttemptResponse(saved));
});

// Mounted at /attempts.
export const attemptsRouter = Router();
attemptsRouter.use(requireAuth);

// The viewer's newest unrated attempt from the last 48 h, or null. Only the
// unrated filter exists: attempt lists are always per recipe.
attemptsRouter.get("/", async (req, res) => {
  if (req.query.unrated !== "true") {
    res.status(400).json({ error: "unrated=true is required" });
    return;
  }

  const attempt = await prisma.attempt.findFirst({
    where: {
      rating: null,
      madeAt: { gte: new Date(Date.now() - UNRATED_WINDOW_MS) },
      recipe: { userId: req.userId },
    },
    orderBy: { madeAt: "desc" },
    // Enough for the card's "How was the Shakshuka?".
    include: { recipe: { select: { id: true, title: true } } },
  });

  res.json(attempt && toAttemptResponse(attempt));
});

attemptsRouter.get("/:id", async (req, res) => {
  const attempt = await prisma.attempt.findFirst({
    where: { id: req.params.id, recipe: { userId: req.userId } },
    include: attemptDetailInclude,
  });

  if (!attempt) {
    res.status(404).json({ error: "Attempt not found" });
    return;
  }

  res.json(toAttemptResponse(attempt));
});

attemptsRouter.get("/:id/photo", async (req, res) => {
  const attempt = await prisma.attempt.findFirst({
    where: { id: req.params.id, recipe: { userId: req.userId } },
    select: { photoPath: true },
  });
  const storageDir = getStorageDir();
  if (!attempt?.photoPath || !storageDir) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  res.sendFile(path.join(storageDir, attempt.photoPath), (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: "Photo not found" });
  });
});

attemptsRouter.patch("/:id", async (req, res) => {
  const existing = await prisma.attempt.findFirst({
    where: { id: req.params.id, recipe: { userId: req.userId } },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ error: "Attempt not found" });
    return;
  }

  const parsed = updateAttemptSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const attempt = await prisma.attempt.update({
    where: { id: existing.id },
    data: parsed.data,
    include: attemptDetailInclude,
  });

  res.json(toAttemptResponse(attempt));
});
