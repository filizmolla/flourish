// Lists the ingredient lines the matcher couldn't link, most common first,
// to decide which foods to add to catalog/foods.ts next. Lines are grouped
// by what's left once amounts, measures and notes are taken off, so
// "1 tbsp neutral oil" and "2 tbsp neutral oil" count as one. Headings are
// left out. Lines the owner unlinked by hand are counted too: an unlink
// often means the right food isn't in the catalog yet.
//
//   npm run unmatched:lines                          (dev database, .env)
//   npx dotenv -e .env.demo -- npm run unmatched:lines
//   npm run unmatched:lines -- 50                    (top 50; default 30)
import "dotenv/config";
import { prisma } from "../src/prisma.js";
import { foldText, isHeadingLine } from "../src/catalog/matcher.js";

const limit = Number(process.argv[2] ?? 30);
if (!Number.isInteger(limit) || limit < 1) throw new Error("Usage: npm run unmatched:lines -- [top N]");

// Folded (ı → i), so written as the matcher sees them. Multi-word Turkish
// measures go first, before their words are taken one by one.
const MEASURE_PHRASES = /\b(su|çay|kahve) bardaği\b|\b(yemek|tatli|çay) kaşiği\b/g;
const MEASURE_WORDS = new Set([
  "cup", "cups", "tbsp", "tsp", "tablespoon", "tablespoons", "teaspoon", "teaspoons",
  "g", "gr", "kg", "ml", "l", "oz", "lb", "lbs", "pinch", "handful", "can", "cans",
  "large", "medium", "small", "of", "a", "about",
  "adet", "gram", "tutam", "paket", "kase", "yarim", "bir", "iki", "üç", "avuç", "dilim",
]);

// The part of a line that names the food: before the first comma, without
// parentheses, amounts or measures.
function groupKey(text: string): string {
  return foldText(text.split(",")[0].replace(/\([^)]*\)/g, " "))
    .replace(MEASURE_PHRASES, " ")
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length > 0 && !MEASURE_WORDS.has(word))
    .join(" ");
}

const lines = await prisma.recipeIngredient.findMany({
  where: { ingredientId: null },
  select: { text: true, recipeId: true, linkSetByOwner: true },
});

type Group = { lines: number; recipes: Set<string>; example: string; unlinkedByOwner: number };
const groups = new Map<string, Group>();
let headings = 0;
for (const line of lines) {
  if (isHeadingLine(line.text)) {
    headings++;
    continue;
  }
  const key = groupKey(line.text) || line.text;
  const group = groups.get(key) ?? { lines: 0, recipes: new Set(), example: line.text, unlinkedByOwner: 0 };
  group.lines++;
  group.recipes.add(line.recipeId);
  if (line.linkSetByOwner) group.unlinkedByOwner++;
  groups.set(key, group);
}

const sorted = [...groups].sort(
  ([keyA, a], [keyB, b]) => b.recipes.size - a.recipes.size || b.lines - a.lines || keyA.localeCompare(keyB),
);

const total = await prisma.recipeIngredient.count();
console.log(
  `${lines.length - headings} unmatched lines of ${total} (${headings} headings left out), ` +
    `${groups.size} groups. Top ${Math.min(limit, sorted.length)}:\n`,
);
console.log("recipes  lines  group  (example)");
for (const [key, group] of sorted.slice(0, limit)) {
  const owner = group.unlinkedByOwner ? `  [${group.unlinkedByOwner} unlinked by owner]` : "";
  console.log(
    `${String(group.recipes.size).padStart(7)}  ${String(group.lines).padStart(5)}  ${key}  (${group.example})${owner}`,
  );
}
await prisma.$disconnect();
