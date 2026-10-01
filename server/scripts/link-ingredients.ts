// Runs the line matcher over every unlinked recipe line, for lines written
// before the matcher existed or before their food was in the catalog. Only
// fills in links: a line that is already linked, or one the owner linked or
// unlinked by hand, is left alone. Rerun after adding foods to
// catalog/foods.ts and `npm run seed:ingredients`.
//
//   npm run link:ingredients                         (dev database, .env)
//   npx dotenv -e .env.demo -- npm run link:ingredients
import "dotenv/config";
import { prisma } from "../src/prisma.js";
import { buildMatcher, CATALOG_KEYS_SELECT } from "../src/catalog/matcher.js";

const match = buildMatcher(await prisma.ingredient.findMany({ select: CATALOG_KEYS_SELECT }));
const unlinked = await prisma.recipeIngredient.findMany({
  where: { ingredientId: null, linkSetByOwner: false },
  select: { id: true, text: true },
});

// Lines grouped by the entry they link to, so it's one update per entry.
const byIngredient = new Map<string, string[]>();
for (const line of unlinked) {
  const ingredientId = match(line.text);
  if (ingredientId) byIngredient.set(ingredientId, [...(byIngredient.get(ingredientId) ?? []), line.id]);
}

let linked = 0;
for (const [ingredientId, ids] of byIngredient) {
  const { count } = await prisma.recipeIngredient.updateMany({
    // ingredientId: null again, in case the line was linked since it was read.
    where: { id: { in: ids }, ingredientId: null, linkSetByOwner: false },
    data: { ingredientId },
  });
  linked += count;
}

console.log(`Lines: ${linked} linked, ${unlinked.length - linked} still unlinked (headings included).`);
await prisma.$disconnect();
