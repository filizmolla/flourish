// Extracts the nutrient values the catalog needs from a USDA FoodData Central
// SR Legacy CSV download into catalog/usda-values.json, which is committed so
// seeding needs no download. Rerun only when catalog/foods.ts gets new foods.
//
//   1. Download "SR Legacy" (CSV) from https://fdc.nal.usda.gov/download-datasets
//      and unzip it anywhere.
//   2. npm run build:catalog -- <path to FoodData_Central_sr_legacy_food_csv_...>
//
// Data: U.S. Department of Agriculture, Agricultural Research Service.
// FoodData Central, 2018 (SR Legacy). fdc.nal.usda.gov. Public domain, CC0 1.0.
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { CATALOG_FOODS } from "../catalog/foods.js";

// USDA nutrient ids → our field names (per 100 g).
const NUTRIENTS: Record<string, string> = {
  "1008": "kcal",
  "1003": "protein",
  "1004": "fat",
  "1258": "satFat",
  "1079": "fiber",
  "1005": "carbs",
};

const OUT_FILE = path.resolve(import.meta.dirname, "../catalog/usda-values.json");

// USDA's CSVs quote every field; "" inside a field is a literal quote.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

async function* readCsv(file: string): AsyncGenerator<Record<string, string>> {
  let header: string[] | null = null;
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    if (!line) continue;
    const fields = parseCsvLine(line);
    if (!header) {
      header = fields;
      continue;
    }
    yield Object.fromEntries(header.map((name, i) => [name, fields[i]]));
  }
}

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: npm run build:catalog -- <SR Legacy CSV folder>");
  process.exit(1);
}

const wanted = new Set(CATALOG_FOODS.flatMap((food) => (food.fdcId ? [food.fdcId] : [])));
const values = new Map<number, { description: string } & Record<string, number | string>>();

for await (const row of readCsv(path.join(dir, "food.csv"))) {
  const fdcId = Number(row.fdc_id);
  if (wanted.has(fdcId)) values.set(fdcId, { description: row.description });
}
for await (const row of readCsv(path.join(dir, "food_nutrient.csv"))) {
  const entry = values.get(Number(row.fdc_id));
  const field = NUTRIENTS[row.nutrient_id];
  if (entry && field) entry[field] = Number(row.amount);
}

const missing = [...wanted].filter((fdcId) => !values.has(fdcId) || values.get(fdcId)!.kcal === undefined);
if (missing.length > 0) {
  console.error(`No food or no energy value in the download for fdcId ${missing.join(", ")}`);
  process.exit(1);
}

// Sorted by fdcId so reruns give a stable diff.
const sorted = Object.fromEntries([...values].sort(([a], [b]) => a - b));
await writeFile(OUT_FILE, JSON.stringify(sorted, null, 2) + "\n");
console.log(`Wrote ${values.size} foods to ${path.relative(process.cwd(), OUT_FILE)}`);
