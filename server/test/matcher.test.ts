import { describe, expect, it } from "vitest";
import { CATALOG_FOODS } from "../catalog/foods.js";
import { buildMatcher, isHeadingLine, type CatalogKeys } from "../src/catalog/matcher.js";
import { normalizeName } from "../src/catalog/tagging.js";

// Phase 5: linking a recipe line to a catalog entry. Pure logic — no database.

// A small hand-built catalog. Ids are readable names so failures say what matched.
const catalog: CatalogKeys[] = [
  { id: "egg", normalizedName: "egg", aliases: ["yumurta"] },
  { id: "eggplant", normalizedName: "eggplant", aliases: ["patlıcan"] },
  { id: "olive", normalizedName: "olive", aliases: ["zeytin"] },
  { id: "olive oil", normalizedName: "olive oil", aliases: ["zeytinyağı"] },
  { id: "tomato", normalizedName: "tomato", aliases: ["domates"] },
  { id: "tomato paste", normalizedName: "tomato paste", aliases: ["domates salçası", "salça"] },
  { id: "chicken breast", normalizedName: "chicken breast", aliases: ["tavuk göğsü"] },
  { id: "flour", normalizedName: "flour", aliases: ["un", "all-purpose flour"] },
  { id: "bread flour", normalizedName: "all purpose bread flour", aliases: [] },
  { id: "spinach", normalizedName: "spinach", aliases: ["ıspanak"] },
  { id: "onion", normalizedName: "onion", aliases: ["soğan"] },
  { id: "carrot", normalizedName: "carrot", aliases: ["havuç"] },
  { id: "ham", normalizedName: "ham", aliases: [] },
  { id: "anchovy", normalizedName: "anchovy", aliases: ["hamsi"] },
  { id: "mint", normalizedName: "mint", aliases: ["nane"] },
  { id: "vine leaves", normalizedName: "vine leaves", aliases: ["yaprak"] },
  { id: "raspberry", normalizedName: "raspberry", aliases: [] },
  { id: "jam", normalizedName: "jam", aliases: [] },
  { id: "garlic", normalizedName: "garlic", aliases: [] },
  { id: "salt", normalizedName: "salt", aliases: [] },
  { id: "pepper", normalizedName: "pepper", aliases: [] },
];

const match = buildMatcher(catalog);

describe("isHeadingLine", () => {
  it.each([
    ["# Sauce", true],
    ["## Dough", true],
    ["  # Sauce  ", true],
    ["#Sauce", false],
    ["# ", false],
    ["2 # eggs", false],
    ["2 eggs", false],
    ["", false],
  ])("%j → %s", (text, expected) => {
    expect(isHeadingLine(text)).toBe(expected);
  });
});

describe("buildMatcher", () => {
  describe("whole words", () => {
    it.each([
      ["2 eggs", "egg"],
      ["1 egg", "egg"],
      ["1 eggplant", "eggplant"],
      ["2 eggplants", "eggplant"],
      ["a handful of olives", "olive"],
      ["2 tbsp olive oil", "olive oil"],
      ["3 tomatoes, diced", "tomato"],
    ])("%j → %s", (line, expected) => {
      expect(match(line)).toBe(expected);
    });

    it("doesn't match a key inside a longer word that isn't an allowed ending", () => {
      expect(match("1 cup eggnog")).toBeNull();
      expect(match("2 hamburgers")).toBeNull();
    });

    it("doesn't match a line that only holds the start of a multi-word key", () => {
      expect(match("1 chicken thigh")).toBeNull();
    });
  });

  describe("longest key wins", () => {
    it.each([
      ["1 tbsp olive oil", "olive oil"],
      ["2 tbsp tomato paste", "tomato paste"],
      ["2 yemek kaşığı domates salçası", "tomato paste"],
      ["1 chicken breast", "chicken breast"],
      ["2 cups all purpose bread flour", "bread flour"],
    ])("%j → %s", (line, expected) => {
      expect(match(line)).toBe(expected);
    });
  });

  describe("aliases", () => {
    it.each([
      ["3 yumurta", "egg"],
      ["1 patlıcan", "eggplant"],
      ["1 yemek kaşığı salça", "tomato paste"],
    ])("%j → %s", (line, expected) => {
      expect(match(line)).toBe(expected);
    });
  });

  describe("only the key's last word takes an ending", () => {
    it.each([
      ["2 chicken breasts", "chicken breast"],
      ["tavuk göğsünü doğrayın", "chicken breast"],
      ["zeytinyağını ısıtın", "olive oil"],
      ["domates salçasını ekleyin", "tomato paste"],
    ])("%j → %s", (line, expected) => {
      expect(match(line)).toBe(expected);
    });

    it("doesn't take an ending on an earlier word of the key", () => {
      // "chickens breast": the ending is on "chicken", not the last word.
      expect(match("2 chickens breast")).toBeNull();
      // "tavuğu göğsü": nor a softened ending on the first word.
      expect(match("tavuğu göğsü")).toBeNull();
    });
  });

  describe("Turkish suffixes and softening", () => {
    it.each([
      ["yumurtayı çırpın", "egg"],
      ["1 su bardağı unu eleyin", "flour"],
      ["ıspanağı yıkayın", "spinach"],
      ["ıspanaklar", "spinach"],
      ["soğanları doğrayın", "onion"],
      ["havucu rendeleyin", "carrot"],
      ["havuçları rendeleyin", "carrot"],
      ["unda bekletin", "flour"],
      ["undan", "flour"],
    ])("%j → %s", (line, expected) => {
      expect(match(line)).toBe(expected);
    });

    it("uses the softened stem only with an ending that starts with a vowel", () => {
      expect(match("havuclar")).toBeNull();
      expect(match("ıspanağlar")).toBeNull();
    });

    it("doesn't take an ending that isn't a suffix", () => {
      expect(match("unutmayın")).toBeNull();
    });
  });

  describe("an exact last word beats one with an ending", () => {
    it("reads hamsi as anchovy, not ham + sı", () => {
      expect(match("500 g hamsi")).toBe("anchovy");
    });

    it("still reads hamı as ham when nothing exact is there", () => {
      expect(match("hamı doğrayın")).toBe("ham");
    });

    it("reads nane yaprakları as mint, not vine leaves", () => {
      expect(match("1 tutam nane yaprakları")).toBe("mint");
    });

    it("beats a later word with an ending", () => {
      expect(match("mint and 2 hams")).toBe("mint");
    });
  });

  describe("the later match wins a tie", () => {
    it.each([
      ["3 tbsp raspberry jam", "jam"],
      ["3 cloves garlic", "garlic"],
      ["salt and pepper", "pepper"],
      ["pepper and salt", "salt"],
      ["2 eggs and 1 onion", "onion"],
    ])("%j → %s", (line, expected) => {
      expect(match(line)).toBe(expected);
    });
  });

  describe("no match", () => {
    it.each([
      ["# Eggs"],
      ["## Olive oil dressing"],
      ["1 cup mystery"],
      ["1/2 su bardağı su"],
      ["2"],
      [""],
      ["   "],
    ])("%j → null", (line) => {
      expect(match(line)).toBeNull();
    });

    it("matches nothing with an empty catalog", () => {
      expect(buildMatcher([])("2 eggs")).toBeNull();
    });
  });

  describe("case and punctuation", () => {
    it("lower-cases Turkish-aware: ISPANAK is ıspanak", () => {
      expect(match("500 g ISPANAK")).toBe("spinach");
      expect(match("ISPANAĞI YIKAYIN")).toBe("spinach");
    });

    it("ignores case in English lines", () => {
      expect(match("2 Eggs")).toBe("egg");
      expect(match("1 TBSP TOMATO PASTE")).toBe("tomato paste");
    });

    // normalizeName lower-cases with the Turkish locale, so an upper-case
    // English I becomes a dotless ı ("OLIVE OIL" → "olıve oıl"); the matcher
    // folds ı into i on both sides.
    it("matches an upper-case English line with an I in it", () => {
      expect(match("1 TBSP OLIVE OIL")).toBe("olive oil");
    });

    it("treats a hyphen in the line as a word break", () => {
      expect(match("2 cups all-purpose bread flour")).toBe("bread flour");
    });

    it("treats a hyphen in the key as a word break", () => {
      expect(match("2 cups all purpose flour")).toBe("flour");
      expect(match("2 cups all-purpose flour")).toBe("flour");
    });

    it("splits words on digits and punctuation", () => {
      expect(match("2eggs")).toBe("egg");
      expect(match("eggs,olives")).toBe("olive");
      expect(match("½ onion")).toBe("onion");
    });
  });
});

describe("the real catalog", () => {
  // Built the way scripts/seed-ingredients.ts builds the rows (that script
  // isn't imported: it writes to the database on import). Ids are food names.
  const realMatch = buildMatcher(
    CATALOG_FOODS.map((food) => {
      const normalizedName = normalizeName(food.name);
      const aliases = [...new Set([...(food.aliases ?? []), ...(food.tr ?? [])].map(normalizeName))].filter(
        (alias) => alias !== normalizedName,
      );
      return { id: food.name, normalizedName, aliases };
    }),
  );

  it.each([
    ["3 garlic cloves, grated", "Garlic"],
    ["1 tbsp olive oil", "Olive oil"],
    ["2 yemek kaşığı domates salçası", "Tomato paste"],
    ["1 su bardağı un", "Flour"],
    ["3 tbsp raspberry jam", "Jam"],
    ["1 eggplant", "Eggplant"],
    ["2 eggs", "Egg"],
    ["2 cups all-purpose flour", "Flour"],
    ["3 adet yumurta", "Egg"],
    ["1 bağ ıspanak", "Spinach"],
    ["2 tavuk göğsü", "Chicken breast"],
    ["1 tutam nane yaprakları", "Mint"],
    ["500 g hamsi", "Anchovies"],
    ["1 su bardağı ılık su", "Water"],
    ["a pinch of salt and pepper", "Black pepper"],
    ["1 red bell pepper", "Bell pepper"],
    ["2 yemek kaşığı biber salçası", "Red pepper paste"],
  ])("%j → %s", (line, expected) => {
    expect(realMatch(line)).toBe(expected);
  });

  it.each([["# Garlic sauce"], ["1/2 su bardağı su"], ["1 cup mystery"]])("%j → null", (line) => {
    expect(realMatch(line)).toBeNull();
  });
});
