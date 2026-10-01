// The ingredient catalog (Phase 5): global and read-only, so there are no
// create/edit/delete routes. Signed-in only, since the detail lists the
// viewer's own recipes.
import { Router } from "express";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { foldText } from "../catalog/matcher.js";
import { FoodGroup } from "../generated/prisma/enums.js";

export const ingredientsRouter = Router();

ingredientsRouter.use(requireAuth);

// GET /ingredients?q=&group=
// q: part of the name or of any alias, English or Turkish ("yumurta" finds
// Egg). group: PROTEIN / FIBER / HEALTHY_FAT match any ingredient that has
// that nutrient, main or not (Fiber also shows avocado); CARB matches the
// main group, since carb isn't a nutrient. Sorted by name. The catalog is a
// few hundred rows, so it's filtered here rather than in SQL, which can't
// search inside the aliases array.
ingredientsRouter.get("/", async (req, res) => {
  const { q, group } = req.query;

  if (q !== undefined && typeof q !== "string") {
    res.status(400).json({ error: "q must be a string" });
    return;
  }
  if (group !== undefined && !Object.values(FoodGroup).includes(group as FoodGroup)) {
    res.status(400).json({ error: `group must be one of ${Object.values(FoodGroup).join(", ")}` });
    return;
  }

  const ingredients = await prisma.ingredient.findMany({
    where:
      group === undefined
        ? {}
        : group === FoodGroup.CARB
          ? { mainGroup: FoodGroup.CARB }
          : { nutrients: { has: group as Exclude<FoodGroup, "CARB"> } },
    select: { id: true, name: true, aliases: true, mainGroup: true, nutrients: true },
    orderBy: { name: "asc" },
  });

  const search = foldText(q ?? "");
  const found = search
    ? ingredients.filter((ingredient) =>
        [ingredient.name, ...ingredient.aliases].some((key) => foldText(key).includes(search)),
      )
    : ingredients;

  res.json(found.map(({ aliases: _aliases, ...ingredient }) => ingredient));
});

// GET /ingredients/:id: the entry, plus the viewer's recipes that have a
// line linked to it (never anyone else's), by title.
ingredientsRouter.get("/:id", async (req, res) => {
  const ingredient = await prisma.ingredient.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, mainGroup: true, nutrients: true, description: true, fdcId: true },
  });

  if (!ingredient) {
    res.status(404).json({ error: "Ingredient not found" });
    return;
  }

  const recipes = await prisma.recipe.findMany({
    where: { userId: req.userId, lines: { some: { ingredientId: ingredient.id } } },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });

  res.json({ ...ingredient, recipes });
});
