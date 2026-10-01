// Loads the ingredient catalog (catalog/foods.ts + catalog/usda-values.json)
// into the `ingredient` table. Idempotent: rows are keyed on normalizedName,
// so rerunning updates them in place and keeps recipe lines linked. A catalog
// row no longer in the list is deleted (its lines become unlinked).
//
//   npm run seed:ingredients                         (dev database, .env)
//   npx dotenv -e .env.demo -- npm run seed:ingredients
//
// Data: U.S. Department of Agriculture, Agricultural Research Service.
// FoodData Central, 2018 (SR Legacy). fdc.nal.usda.gov. Public domain, CC0 1.0.
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CATALOG_FOODS, type CatalogFood } from "../catalog/foods.js";
import { prisma } from "../src/prisma.js";
import { normalizeName, tagFood, type FoodTags, type NutrientValues } from "../src/catalog/tagging.js";

const valuesFile = path.resolve(import.meta.dirname, "../catalog/usda-values.json");
const usdaValues = JSON.parse(await readFile(valuesFile, "utf8")) as Record<string, NutrientValues>;

function tagsFor(food: CatalogFood): FoodTags {
  if (food.seasoning) return { mainGroup: null, nutrients: [] };
  if (food.override) return { mainGroup: food.override.mainGroup, nutrients: food.override.nutrients };
  const values = food.fdcId === null ? undefined : usdaValues[food.fdcId];
  if (!values) throw new Error(`${food.name}: no USDA values (run npm run build:catalog) and no override`);
  return tagFood(values);
}

// Checks the list before touching the database: every name and alias maps to
// one food, and a main group that is a nutrient is also in the nutrients.
const rows = CATALOG_FOODS.map((food) => {
  const normalizedName = normalizeName(food.name);
  const aliases = [...new Set([...(food.aliases ?? []), ...(food.tr ?? [])].map(normalizeName))].filter(
    (alias) => alias !== normalizedName,
  );
  const tags = tagsFor(food);
  if (tags.mainGroup && tags.mainGroup !== "CARB" && !tags.nutrients.includes(tags.mainGroup)) {
    throw new Error(`${food.name}: main group ${tags.mainGroup} is missing from its nutrients`);
  }
  return { name: food.name, normalizedName, aliases, fdcId: food.fdcId, ...tags };
});

const owner = new Map<string, string>();
for (const row of rows) {
  for (const key of [row.normalizedName, ...row.aliases]) {
    const other = owner.get(key);
    if (other && other !== row.name) throw new Error(`"${key}" is used by both ${other} and ${row.name}`);
    owner.set(key, row.name);
  }
}

let created = 0;
let updated = 0;
for (const row of rows) {
  const existing = await prisma.ingredient.findUnique({ where: { normalizedName: row.normalizedName } });
  await prisma.ingredient.upsert({
    where: { normalizedName: row.normalizedName },
    create: row,
    update: row,
  });
  if (existing) updated++;
  else created++;
}

const stale = await prisma.ingredient.deleteMany({
  where: { normalizedName: { notIn: rows.map((row) => row.normalizedName) } },
});

const byGroup = new Map<string, number>();
for (const row of rows) byGroup.set(row.mainGroup ?? "none", (byGroup.get(row.mainGroup ?? "none") ?? 0) + 1);
console.log(
  `Ingredients: ${created} created, ${updated} updated, ${stale.count} removed (${rows.length} in the catalog).`,
);
console.log(`Main groups: ${[...byGroup].map(([group, count]) => `${group} ${count}`).join(", ")}`);
await prisma.$disconnect();
