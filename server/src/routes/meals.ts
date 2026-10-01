// Meals and snacks eaten anywhere (Phase 6): an optional photo, optional text
// and an optional "How did you feel after?". Every query is scoped by
// userId, so another user's meal (or its photo) is a 404.
import express, { Router } from "express";
import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Fullness, MealKind, Nutrient, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { buildMatcher, CATALOG_KEYS_SELECT, foldText } from "../catalog/matcher.js";
import { getStorageDir, readImageInfo, writeRowPhoto } from "../importPhotos.js";

export const mealsRouter = Router();

// One photo, shrunk by the app like import photos (300 KB–1 MB), in base64.
const MEAL_BODY_LIMIT = "4mb";

export const MAX_MEAL_TEXT = 500;

// How many recent snacks the app offers as chips.
export const RECENT_SNACK_COUNT = 8;
// How far back recent snacks look, in snack rows.
const RECENT_SNACK_SCAN = 200;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

// A blank text means "no text", same as null.
const mealText = z
  .string()
  .trim()
  .max(MAX_MEAL_TEXT)
  .transform((value) => value || null)
  .nullable()
  .optional();

const eatenAt = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const createMealSchema = z.strictObject({
  kind: z.enum(MealKind).optional(),
  eatenAt: eatenAt.optional(),
  text: mealText,
  fullness: z.enum(Fullness).nullable().optional(),
  // One JPEG or PNG in base64.
  photo: z.string().regex(BASE64_PATTERN, "photo must be a base64 string").optional(),
});

// The photo can't be changed after saving (delete and add again).
const updateMealSchema = z.strictObject({
  kind: z.enum(MealKind).optional(),
  eatenAt: eatenAt.optional(),
  text: mealText,
  fullness: z.enum(Fullness).nullable().optional(),
});

const rangeSchema = z.strictObject({
  from: eatenAt.optional(),
  to: eatenAt.optional(),
});

// "kind: Invalid option: expected one of …"
function formatZodError(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue.path.join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}

// A meal's text is a list of foods, not recipe lines: "leftover pasta,
// spinach", "apple + peanut butter", "yogurt with berries". The matcher
// links one food per piece, so the text is cut into pieces first.
export function mealTextPieces(text: string): string[] {
  return text
    .split(/[,;\n+&]|\s(?:and|with|ve|ile)\s/i)
    .map((piece) => piece.trim())
    .filter(Boolean);
}

// The nutrients the foods in `text` bring, in a fixed order. The catalog is
// read per request, like recipe lines, so a reseed shows up at once.
export async function mealNutrients(text: string | null): Promise<Nutrient[]> {
  if (!text) return [];
  const catalog = await prisma.ingredient.findMany({ select: { ...CATALOG_KEYS_SELECT, nutrients: true } });
  const match = buildMatcher(catalog);
  const byId = new Map(catalog.map((entry) => [entry.id, entry.nutrients]));
  const found = new Set(
    mealTextPieces(text).flatMap((piece) => {
      const id = match(piece);
      return id ? (byId.get(id) ?? []) : [];
    }),
  );
  return Object.values(Nutrient).filter((nutrient) => found.has(nutrient));
}

export const mealSelect = {
  id: true,
  kind: true,
  eatenAt: true,
  text: true,
  nutrients: true,
  fullness: true,
  photoPath: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MealSelect;

type MealRow = Prisma.MealGetPayload<{ select: typeof mealSelect }>;

// The disk path stays on the server; the app asks GET /meals/:id/photo.
export function toMealResponse({ photoPath, ...meal }: MealRow) {
  return { ...meal, hasPhoto: photoPath !== null };
}

// Mounted before the global express.json() in app.ts, so a photo upload gets
// its own body limit; auth runs first, so a large body is only parsed when
// signed in.
mealsRouter.use(requireAuth);
mealsRouter.use(express.json({ limit: MEAL_BODY_LIMIT }));

mealsRouter.get("/", async (req, res) => {
  const parsed = rangeSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const { from, to } = parsed.data;

  const meals = await prisma.meal.findMany({
    where: {
      userId: req.userId,
      ...((from || to) && { eatenAt: { ...(from && { gte: from }), ...(to && { lt: to }) } }),
    },
    select: mealSelect,
    orderBy: { eatenAt: "desc" },
  });
  res.json(meals.map(toMealResponse));
});

// The viewer's last distinct snack texts, newest first (case-insensitive:
// "Apple + PB" and "apple + pb" are one). Stands in for a fridge list.
mealsRouter.get("/recent-snacks", async (req, res) => {
  const snacks = await prisma.meal.findMany({
    where: { userId: req.userId, kind: MealKind.SNACK, text: { not: null } },
    select: { text: true },
    orderBy: { eatenAt: "desc" },
    take: RECENT_SNACK_SCAN,
  });

  const seen = new Set<string>();
  const recent: string[] = [];
  for (const { text } of snacks) {
    // foldText, not a plain Turkish lower-case: that turns the I in "KIWI"
    // into ı, so it wouldn't match "kiwi".
    const key = foldText(text!);
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push(text!);
    if (recent.length === RECENT_SNACK_COUNT) break;
  }
  res.json(recent);
});

mealsRouter.post("/", async (req, res) => {
  const parsed = createMealSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const { photo, text, ...rest } = parsed.data;

  const data = photo ? Buffer.from(photo, "base64") : null;
  const info = data ? readImageInfo(data) : null;
  if (data && !info) {
    res.status(400).json({ error: "photo is not a JPEG or PNG" });
    return;
  }
  if (!data && !text) {
    res.status(400).json({ error: "A meal needs a photo or text" });
    return;
  }

  const storageDir = data ? getStorageDir() : null;
  if (data && !storageDir) {
    throw new Error("STORAGE_DIR must be set to keep meal photos");
  }

  const userId = req.userId!;
  const meal = await prisma.meal.create({
    data: { ...rest, userId, text, nutrients: await mealNutrients(text ?? null) },
    select: mealSelect,
  });

  if (!data || !info || !storageDir) {
    res.status(201).json(toMealResponse(meal));
    return;
  }

  // The row first, so the file is named after it; a failed write removes the
  // row again rather than leave a meal with a missing photo.
  let photoPath: string;
  try {
    photoPath = await writeRowPhoto(storageDir, "meals", userId, meal.id, { data, mimeType: info.mimeType });
  } catch (error) {
    await prisma.meal.delete({ where: { id: meal.id } });
    throw error;
  }

  const saved = await prisma.meal.update({ where: { id: meal.id }, data: { photoPath }, select: mealSelect });
  res.status(201).json(toMealResponse(saved));
});

async function findOwnedMeal(id: string, userId: string) {
  return prisma.meal.findFirst({ where: { id, userId }, select: mealSelect });
}

mealsRouter.get("/:id", async (req, res) => {
  const meal = await findOwnedMeal(req.params.id, req.userId!);
  if (!meal) {
    res.status(404).json({ error: "Meal not found" });
    return;
  }
  res.json(toMealResponse(meal));
});

mealsRouter.get("/:id/photo", async (req, res) => {
  const meal = await findOwnedMeal(req.params.id, req.userId!);
  const storageDir = getStorageDir();
  if (!meal?.photoPath || !storageDir) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  res.sendFile(path.join(storageDir, meal.photoPath), (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: "Photo not found" });
  });
});

// Omitted = left as is; null = cleared. New text recomputes the nutrients.
mealsRouter.patch("/:id", async (req, res) => {
  const parsed = updateMealSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const existing = await findOwnedMeal(req.params.id, req.userId!);
  if (!existing) {
    res.status(404).json({ error: "Meal not found" });
    return;
  }

  const { text, ...rest } = parsed.data;
  if (text !== undefined && !text && !existing.photoPath) {
    res.status(400).json({ error: "A meal needs a photo or text" });
    return;
  }

  const meal = await prisma.meal.update({
    where: { id: existing.id },
    data: {
      ...rest,
      ...(text !== undefined && { text, nutrients: await mealNutrients(text) }),
    },
    select: mealSelect,
  });
  res.json(toMealResponse(meal));
});

mealsRouter.delete("/:id", async (req, res) => {
  const existing = await findOwnedMeal(req.params.id, req.userId!);
  if (!existing) {
    res.status(404).json({ error: "Meal not found" });
    return;
  }

  await prisma.meal.delete({ where: { id: existing.id } });
  const storageDir = getStorageDir();
  if (existing.photoPath && storageDir) {
    await rm(path.join(storageDir, existing.photoPath), { force: true });
  }
  res.status(204).send();
});
