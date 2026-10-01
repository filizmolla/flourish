// GET /week?from=&to= (Phase 6 "Your week"): the viewer's meals and cooked
// attempts in a range, each with the nutrients it brought. The app sends its
// own week bounds (Monday to Monday in the phone's time zone), groups by day
// and works out the triangle itself, so no counts leave for the screen.
import { Router } from "express";
import { z } from "zod";
import { Nutrient } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { mealSelect, toMealResponse } from "./meals.js";

export const weekRouter = Router();
weekRouter.use(requireAuth);

// A week plus some slack for daylight-saving shifts; the app asks for one
// week at a time.
const MAX_RANGE_MS = 8 * 24 * 60 * 60 * 1000;

const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

// zod runs object-level refines even after a field failed, with the raw
// string in place of the Date, so each one only runs on a clean parse.
const onlyIfValid = { when: (payload: { issues: unknown[] }) => payload.issues.length === 0 };

const weekQuery = z
  .strictObject({ from: instant, to: instant })
  .refine(({ from, to }) => from < to, { message: "from must be before to", ...onlyIfValid })
  .refine(({ from, to }) => to.getTime() - from.getTime() <= MAX_RANGE_MS, {
    message: "The range can be at most 8 days",
    ...onlyIfValid,
  });

weekRouter.get("/", async (req, res) => {
  const parsed = weekQuery.safeParse(req.query);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.join(".");
    res.status(400).json({ error: field ? `${field}: ${issue.message}` : issue.message });
    return;
  }
  const { from, to } = parsed.data;

  const [meals, attempts] = await Promise.all([
    prisma.meal.findMany({
      where: { userId: req.userId, eatenAt: { gte: from, lt: to } },
      select: mealSelect,
      orderBy: { eatenAt: "asc" },
    }),
    // Attempts have no userId: they're scoped through the recipe's owner.
    prisma.attempt.findMany({
      where: { recipe: { userId: req.userId }, madeAt: { gte: from, lt: to } },
      select: {
        id: true,
        recipeId: true,
        madeAt: true,
        rating: true,
        fullness: true,
        photoPath: true,
        recipe: {
          select: {
            title: true,
            imageUrl: true,
            // The recipe's linked lines as they are today, not the attempt's
            // snapshot: snapshot lines carry no links.
            lines: { select: { ingredient: { select: { nutrients: true } } } },
          },
        },
      },
      orderBy: { madeAt: "asc" },
    }),
  ]);

  res.json({
    meals: meals.map(toMealResponse),
    attempts: attempts.map(({ recipe, photoPath, ...attempt }) => {
      const present = new Set(recipe.lines.flatMap((line) => line.ingredient?.nutrients ?? []));
      return {
        ...attempt,
        hasPhoto: photoPath !== null,
        recipe: { id: attempt.recipeId, title: recipe.title, imageUrl: recipe.imageUrl },
        nutrients: Object.values(Nutrient).filter((nutrient) => present.has(nutrient)),
      };
    }),
  });
});
