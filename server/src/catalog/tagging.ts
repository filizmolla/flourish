// Which nutrients a food brings, and what it mostly is, from its USDA values
// per 100 g. Wording stays neutral.
//
// Per calorie rather than per gram, so water doesn't decide (a raw and a
// cooked lentil come out the same), plus an absolute floor where per calorie
// alone would flatter very light foods (spinach is 50% protein by calories,
// but you'd eat a kilo for 30 g). Tuned 2026-09-29 against the whole catalog;
// the few calls it gets wrong are overrides in catalog/foods.ts.
import type { FoodGroup, Nutrient } from "../generated/prisma/enums.js";

// Per 100 g, from USDA FoodData Central. A missing value means USDA has none.
export type NutrientValues = {
  kcal: number;
  protein?: number;
  fat?: number;
  satFat?: number;
  fiber?: number;
  carbs?: number;
};

// Protein: at least 20% of calories, and at least 5 g per 100 g.
export const PROTEIN_MIN_SHARE = 0.2;
export const PROTEIN_MIN_GRAMS = 5;
// Fiber: at least 2 g per 100 kcal.
export const FIBER_MIN_PER_100_KCAL = 2;
// Healthy fat: at least 35% of calories and 3 g per 100 g, with at most a
// quarter of the fat saturated (so olive oil and nuts count, butter doesn't).
// A food with no saturated-fat value doesn't count.
export const FAT_MIN_SHARE = 0.35;
export const FAT_MIN_GRAMS = 3;
export const SAT_FAT_MAX_RATIO = 0.25;
// Carb: none of the three, and at least half the calories from carbohydrate.
export const CARB_MIN_SHARE = 0.5;

export type FoodTags = { mainGroup: FoodGroup | null; nutrients: Nutrient[] };

const NUTRIENT_ORDER: Nutrient[] = ["PROTEIN", "FIBER", "HEALTHY_FAT"];

export function tagFood(values: NutrientValues): FoodTags {
  const { kcal } = values;
  if (!(kcal > 0)) return { mainGroup: null, nutrients: [] };

  const protein = values.protein ?? 0;
  const fat = values.fat ?? 0;
  const proteinShare = (protein * 4) / kcal;
  const fiberPer100Kcal = ((values.fiber ?? 0) * 100) / kcal;
  const fatShare = (fat * 9) / kcal;
  const carbShare = ((values.carbs ?? 0) * 4) / kcal;

  // How far past its line each nutrient is; the strongest is the main group.
  const strength = new Map<Nutrient, number>();
  if (proteinShare >= PROTEIN_MIN_SHARE && protein >= PROTEIN_MIN_GRAMS) {
    strength.set("PROTEIN", proteinShare / PROTEIN_MIN_SHARE);
  }
  if (fiberPer100Kcal >= FIBER_MIN_PER_100_KCAL) {
    strength.set("FIBER", fiberPer100Kcal / FIBER_MIN_PER_100_KCAL);
  }
  if (
    fatShare >= FAT_MIN_SHARE &&
    fat >= FAT_MIN_GRAMS &&
    values.satFat !== undefined &&
    values.satFat / fat <= SAT_FAT_MAX_RATIO
  ) {
    strength.set("HEALTHY_FAT", fatShare / FAT_MIN_SHARE);
  }

  const nutrients = NUTRIENT_ORDER.filter((nutrient) => strength.has(nutrient));
  if (nutrients.length > 0) {
    const mainGroup = nutrients.reduce((best, nutrient) =>
      strength.get(nutrient)! > strength.get(best)! ? nutrient : best,
    );
    return { mainGroup, nutrients };
  }
  return { mainGroup: carbShare >= CARB_MIN_SHARE ? "CARB" : null, nutrients: [] };
}

// Lower-case (Turkish-aware: I → ı, İ → i), trimmed, single spaces. What
// names and aliases are stored as, and what the line matcher compares.
export function normalizeName(text: string): string {
  return text.trim().toLocaleLowerCase("tr").replace(/\s+/g, " ");
}
