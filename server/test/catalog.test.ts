import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_FOODS, type CatalogFood } from "../catalog/foods.js";
import {
  CARB_MIN_SHARE,
  FAT_MIN_GRAMS,
  FAT_MIN_SHARE,
  FIBER_MIN_PER_100_KCAL,
  normalizeName,
  PROTEIN_MIN_GRAMS,
  PROTEIN_MIN_SHARE,
  SAT_FAT_MAX_RATIO,
  tagFood,
  type FoodTags,
  type NutrientValues,
} from "../src/catalog/tagging.js";

// Phase 5 Slice B: the ingredient catalog and the rule that tags each food
// with its nutrients and main group. Pure logic and data — no database.

const usdaValues = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../catalog/usda-values.json"), "utf8"),
) as Record<string, NutrientValues>;

// The same rules scripts/seed-ingredients.ts applies when it builds a row
// (the script itself isn't imported: it writes to the database on import).
function storedTags(food: CatalogFood): FoodTags {
  if (food.seasoning) return { mainGroup: null, nutrients: [] };
  if (food.override) return { mainGroup: food.override.mainGroup, nutrients: food.override.nutrients };
  const values = food.fdcId === null ? undefined : usdaValues[food.fdcId];
  if (!values) throw new Error(`${food.name}: no USDA values and no override`);
  return tagFood(values);
}

function storedKeys(food: CatalogFood): string[] {
  const normalizedName = normalizeName(food.name);
  const aliases = [...new Set([...(food.aliases ?? []), ...(food.tr ?? [])].map(normalizeName))].filter(
    (alias) => alias !== normalizedName,
  );
  return [normalizedName, ...aliases];
}

function food(name: string): CatalogFood {
  const found = CATALOG_FOODS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`${name} is not in the catalog`);
  return found;
}

describe("tagFood thresholds", () => {
  it("has the documented thresholds", () => {
    expect({
      PROTEIN_MIN_SHARE,
      PROTEIN_MIN_GRAMS,
      FIBER_MIN_PER_100_KCAL,
      FAT_MIN_SHARE,
      FAT_MIN_GRAMS,
      SAT_FAT_MAX_RATIO,
      CARB_MIN_SHARE,
    }).toEqual({
      PROTEIN_MIN_SHARE: 0.2,
      PROTEIN_MIN_GRAMS: 5,
      FIBER_MIN_PER_100_KCAL: 2,
      FAT_MIN_SHARE: 0.35,
      FAT_MIN_GRAMS: 3,
      SAT_FAT_MAX_RATIO: 0.25,
      CARB_MIN_SHARE: 0.5,
    });
  });

  describe("protein", () => {
    it("counts exactly 20% of kcal with exactly 5 g", () => {
      expect(tagFood({ kcal: 100, protein: 5 })).toEqual({ mainGroup: "PROTEIN", nutrients: ["PROTEIN"] });
    });

    it("doesn't count just under 20% of kcal", () => {
      expect(tagFood({ kcal: 100, protein: 4.9 }).nutrients).not.toContain("PROTEIN");
    });

    it("doesn't count a light food under the 5 g floor, even at 50% of kcal", () => {
      // A light green: 3 g protein in 24 kcal is 50% of its calories.
      expect(tagFood({ kcal: 24, protein: 3 }).nutrients).not.toContain("PROTEIN");
    });

    it("doesn't count 4.9 g even at a high share", () => {
      expect(tagFood({ kcal: 30, protein: 4.9 }).nutrients).not.toContain("PROTEIN");
    });
  });

  describe("fiber", () => {
    it("counts exactly 2 g per 100 kcal", () => {
      expect(tagFood({ kcal: 100, fiber: 2 })).toEqual({ mainGroup: "FIBER", nutrients: ["FIBER"] });
    });

    it("doesn't count just under 2 g per 100 kcal", () => {
      expect(tagFood({ kcal: 100, fiber: 1.99 }).nutrients).not.toContain("FIBER");
    });

    it("has no gram floor (per calorie only)", () => {
      expect(tagFood({ kcal: 20, fiber: 0.4 }).nutrients).toContain("FIBER");
    });
  });

  describe("healthy fat", () => {
    it("counts exactly 35% of kcal with sat fat exactly a quarter of fat", () => {
      expect(tagFood({ kcal: 180, fat: 7, satFat: 1.75 })).toEqual({
        mainGroup: "HEALTHY_FAT",
        nutrients: ["HEALTHY_FAT"],
      });
    });

    it("doesn't count just under 35% of kcal", () => {
      expect(tagFood({ kcal: 180, fat: 6.9, satFat: 1 }).nutrients).not.toContain("HEALTHY_FAT");
    });

    it("counts exactly 3 g of fat", () => {
      expect(tagFood({ kcal: 27, fat: 3, satFat: 0.5 }).nutrients).toContain("HEALTHY_FAT");
    });

    it("doesn't count under the 3 g floor, even at a high share", () => {
      expect(tagFood({ kcal: 27, fat: 2.9, satFat: 0.5 }).nutrients).not.toContain("HEALTHY_FAT");
    });

    it("doesn't count a food with no saturated-fat value", () => {
      expect(tagFood({ kcal: 900, fat: 100 })).toEqual({ mainGroup: null, nutrients: [] });
    });

    it("doesn't count a sat/fat ratio of 0.26", () => {
      expect(tagFood({ kcal: 200, fat: 10, satFat: 2.6 }).nutrients).not.toContain("HEALTHY_FAT");
    });

    it("counts a sat fat of 0", () => {
      expect(tagFood({ kcal: 900, fat: 100, satFat: 0 }).nutrients).toEqual(["HEALTHY_FAT"]);
    });
  });

  describe("main group", () => {
    it("picks protein when it is furthest past its line", () => {
      // protein 50% of kcal (2.5x its line), fat 45% (≈1.3x).
      expect(tagFood({ kcal: 200, protein: 25, fat: 10, satFat: 1 })).toEqual({
        mainGroup: "PROTEIN",
        nutrients: ["PROTEIN", "HEALTHY_FAT"],
      });
    });

    it("picks healthy fat when it is furthest past its line", () => {
      // protein 24% of kcal (1.2x), fat 81% (≈2.3x).
      expect(tagFood({ kcal: 200, protein: 12, fat: 18, satFat: 2 })).toEqual({
        mainGroup: "HEALTHY_FAT",
        nutrients: ["PROTEIN", "HEALTHY_FAT"],
      });
    });

    it("picks fiber when it is furthest past its line", () => {
      // fiber 6 g per 100 kcal (3x), protein 24% (1.2x).
      expect(tagFood({ kcal: 100, protein: 6, fiber: 6 })).toEqual({
        mainGroup: "FIBER",
        nutrients: ["PROTEIN", "FIBER"],
      });
    });

    it("lists nutrients in a fixed order: protein, fiber, healthy fat", () => {
      expect(tagFood({ kcal: 200, protein: 12, fiber: 10, fat: 18, satFat: 2 }).nutrients).toEqual([
        "PROTEIN",
        "FIBER",
        "HEALTHY_FAT",
      ]);
    });
  });

  describe("fallback without nutrients", () => {
    it("is CARB at exactly 50% of kcal from carbs", () => {
      expect(tagFood({ kcal: 100, carbs: 12.5 })).toEqual({ mainGroup: "CARB", nutrients: [] });
    });

    it("is null just under 50% of kcal from carbs", () => {
      expect(tagFood({ kcal: 100, carbs: 12.4 })).toEqual({ mainGroup: null, nutrients: [] });
    });

    it("is never CARB when a nutrient qualifies", () => {
      expect(tagFood({ kcal: 100, carbs: 20, fiber: 3 })).toEqual({ mainGroup: "FIBER", nutrients: ["FIBER"] });
    });
  });

  it.each([0, -5, Number.NaN])("returns nothing for kcal %s", (kcal) => {
    expect(tagFood({ kcal, protein: 10, fiber: 10, fat: 10, satFat: 1, carbs: 10 })).toEqual({
      mainGroup: null,
      nutrients: [],
    });
  });
});

describe("well-known foods, tagged from the real catalog data", () => {
  it.each<[string, FoodTags]>([
    ["Avocado", { mainGroup: "HEALTHY_FAT", nutrients: ["FIBER", "HEALTHY_FAT"] }],
    ["Edamame", { mainGroup: "FIBER", nutrients: ["PROTEIN", "FIBER", "HEALTHY_FAT"] }],
    ["Olive oil", { mainGroup: "HEALTHY_FAT", nutrients: ["HEALTHY_FAT"] }],
    ["Walnuts", { mainGroup: "HEALTHY_FAT", nutrients: ["HEALTHY_FAT"] }],
    ["Salmon", { mainGroup: "PROTEIN", nutrients: ["PROTEIN", "HEALTHY_FAT"] }],
    ["Egg", { mainGroup: "PROTEIN", nutrients: ["PROTEIN"] }],
    ["Chicken breast", { mainGroup: "PROTEIN", nutrients: ["PROTEIN"] }],
    ["Lentils", { mainGroup: "FIBER", nutrients: ["PROTEIN", "FIBER"] }],
    ["Chickpeas", { mainGroup: "FIBER", nutrients: ["PROTEIN", "FIBER"] }],
    ["Spinach", { mainGroup: "FIBER", nutrients: ["FIBER"] }],
    ["Broccoli", { mainGroup: "FIBER", nutrients: ["FIBER"] }],
    ["Butter", { mainGroup: null, nutrients: [] }],
    ["Heavy cream", { mainGroup: null, nutrients: [] }],
    ["Coconut oil", { mainGroup: null, nutrients: [] }],
    ["Rice", { mainGroup: "CARB", nutrients: [] }],
    ["Pasta", { mainGroup: "CARB", nutrients: [] }],
    ["Sugar", { mainGroup: "CARB", nutrients: [] }],
    ["Flour", { mainGroup: "CARB", nutrients: [] }],
    ["Whole wheat flour", { mainGroup: "FIBER", nutrients: ["FIBER"] }],
    ["Oats", { mainGroup: "FIBER", nutrients: ["FIBER"] }],
    ["Tofu", { mainGroup: "PROTEIN", nutrients: ["PROTEIN", "HEALTHY_FAT"] }],
    ["Milk", { mainGroup: "PROTEIN", nutrients: ["PROTEIN"] }],
    ["Yogurt", { mainGroup: "PROTEIN", nutrients: ["PROTEIN"] }],
    ["Potato", { mainGroup: "CARB", nutrients: ["FIBER"] }],
  ])("%s", (name, expected) => {
    expect(storedTags(food(name))).toEqual(expected);
  });

  it("Milk, Yogurt and Potato only pass through their overrides", () => {
    // The rule alone would call them differently; that's why the overrides exist.
    for (const name of ["Milk", "Yogurt", "Potato"]) {
      const entry = food(name);
      expect(entry.override, name).toBeDefined();
      expect(tagFood(usdaValues[entry.fdcId!]), name).not.toEqual(storedTags(entry));
    }
  });
});

describe("catalog integrity", () => {
  it("has unique names", () => {
    const names = CATALOG_FOODS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("maps every normalized name and alias to exactly one food", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const entry of CATALOG_FOODS) {
      for (const key of storedKeys(entry)) {
        const other = owner.get(key);
        if (other && other !== entry.name) clashes.push(`"${key}": ${other} / ${entry.name}`);
        owner.set(key, entry.name);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("has USDA values with kcal for every non-seasoning food without an override", () => {
    const missing = CATALOG_FOODS.filter((entry) => !entry.seasoning && !entry.override)
      .filter((entry) => entry.fdcId === null || typeof usdaValues[entry.fdcId]?.kcal !== "number")
      .map((entry) => entry.name);
    expect(missing).toEqual([]);
  });

  it("has a non-empty why on every override, and its nutrient main group in its nutrients", () => {
    const overrides = CATALOG_FOODS.filter((entry) => entry.override);
    expect(overrides.length).toBeGreaterThan(0);
    for (const entry of overrides) {
      const { mainGroup, nutrients, why } = entry.override!;
      expect(why.trim(), entry.name).not.toBe("");
      if (mainGroup && mainGroup !== "CARB") expect(nutrients, entry.name).toContain(mainGroup);
    }
  });

  it("stores a nutrient main group only when it is also in the nutrients, for every food", () => {
    for (const entry of CATALOG_FOODS) {
      const { mainGroup, nutrients } = storedTags(entry);
      if (mainGroup && mainGroup !== "CARB") expect(nutrients, entry.name).toContain(mainGroup);
    }
  });

  it("stores seasonings with no main group and no nutrients", () => {
    for (const entry of CATALOG_FOODS.filter((candidate) => candidate.seasoning)) {
      expect(storedTags(entry), entry.name).toEqual({ mainGroup: null, nutrients: [] });
    }
  });

  it.each(["su", "cup", "cups", "kaşık", "bardak", "tbsp", "tsp", "gram", "g", "adet", "tutam", "pinch"])(
    "doesn't use the measure word %j as a name or alias",
    (word) => {
      const keys = CATALOG_FOODS.flatMap(storedKeys);
      expect(keys).not.toContain(normalizeName(word));
    },
  );
});

describe("normalizeName", () => {
  it.each([
    ["Olive oil", "olive oil"],
    ["  Olive   oil  ", "olive oil"],
    ["olive\toil\n", "olive oil"],
    ["IŞIK", "ışık"],
    ["İnci", "inci"],
    ["ISPANAK", "ıspanak"],
    ["Zeytinyağı", "zeytinyağı"],
    ["ÇEDAR ŞEKER ÜZÜM ĞÖ", "çedar şeker üzüm ğö"],
    ["", ""],
    ["   ", ""],
  ])("%j → %j", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it("is idempotent", () => {
    const once = normalizeName("  Tavuk  GÖĞSÜ ");
    expect(normalizeName(once)).toBe(once);
  });
});
