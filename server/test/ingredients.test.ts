import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import type { FoodGroup, Nutrient } from "../src/generated/prisma/enums.js";
import { authed, createRecipe, createTestUser, deleteTestUsers, TestUser } from "./helpers.js";

// Phase 5: the read-only ingredient catalog. The catalog table is global and
// other test files add rows to it in parallel, so every row here carries a
// made-up word plus a per-run token, and assertions only look at our own ids.

const GROUP_ERROR = "group must be one of PROTEIN, FIBER, HEALTHY_FAT, CARB";

// Hex only (no "i"), so Turkish lower-casing can't change it.
const TOKEN = randomUUID().replace(/-/g, "").slice(0, 10);

// fdcId is unique across the shared catalog, so pick one far above real
// USDA ids (and away from lineLinks.test.ts's 2_000_000_000+ range).
const EGG_FDC_ID = 1_500_000_000 + Math.floor(Math.random() * 100_000_000);

type Row = { id: string; name: string; mainGroup: FoodGroup | null; nutrients: Nutrient[] };

let alice: TestUser;
let bob: TestUser;
const rows: Record<string, Row> = {};
const ingredientIds: string[] = [];

async function createCatalogRow(
  key: string,
  label: string,
  mainGroup: FoodGroup | null,
  nutrients: Nutrient[],
  extra: { aliases?: string[]; description?: string; fdcId?: number } = {},
): Promise<void> {
  const name = `Zeppolt ${label} ${TOKEN}`;
  const ingredient = await prisma.ingredient.create({
    data: {
      name,
      normalizedName: name.toLowerCase(),
      aliases: extra.aliases ?? [],
      mainGroup,
      nutrients,
      description: extra.description ?? null,
      fdcId: extra.fdcId ?? null,
    },
  });
  ingredientIds.push(ingredient.id);
  rows[key] = { id: ingredient.id, name, mainGroup, nutrients };
}

// Keeps only our rows, in the order the response returned them.
function ours(body: Row[]): Row[] {
  return body.filter((row) => ingredientIds.includes(row.id));
}

function list(user: TestUser, query: string) {
  return request(app).get(`/ingredients${query}`).set(authed(user));
}

beforeAll(async () => {
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");

  await createCatalogRow("egg", "Egg", "PROTEIN", ["PROTEIN"], {
    aliases: [`zeppolt yumurta ${TOKEN}`],
    description: "A made-up egg.",
    fdcId: EGG_FDC_ID,
  });
  await createCatalogRow("oliveOil", "Olive Oil", "HEALTHY_FAT", ["HEALTHY_FAT"]);
  await createCatalogRow("avocado", "Avocado", "HEALTHY_FAT", ["HEALTHY_FAT", "FIBER"]);
  await createCatalogRow("spinach", "Spinach", "FIBER", ["FIBER"], { aliases: [`zeppolt ıspanak ${TOKEN}`] });
  await createCatalogRow("rice", "Rice", "CARB", []);
  await createCatalogRow("oats", "Oats", "CARB", ["FIBER"]);
  await createCatalogRow("salt", "Salt", null, []);
});

afterAll(async () => {
  await deleteTestUsers(alice, bob);
  await prisma.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
  await prisma.$disconnect();
});

describe("GET /ingredients", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/ingredients");

    expect(res.status).toBe(401);
  });

  it("returns every entry sorted by name, without aliases, when there is no filter", async () => {
    const res = await list(alice, "");

    expect(res.status).toBe(200);
    expect(ours(res.body)).toEqual([
      rows.avocado,
      rows.egg,
      rows.oats,
      rows.oliveOil,
      rows.rice,
      rows.salt,
      rows.spinach,
    ]);
    for (const row of ours(res.body)) expect(Object.keys(row).sort()).toEqual(["id", "mainGroup", "name", "nutrients"]);
  });

  it("treats an empty q as no search filter", async () => {
    const res = await list(alice, "?q=");

    expect(res.status).toBe(200);
    expect(ours(res.body)).toHaveLength(7);
  });

  describe("q", () => {
    it("matches part of the name", async () => {
      const res = await list(alice, `?q=${encodeURIComponent(`olive oil ${TOKEN}`)}`);

      expect(res.status).toBe(200);
      expect(ours(res.body)).toEqual([rows.oliveOil]);
    });

    it("matches the name case-insensitively, English capital I included", async () => {
      const res = await list(alice, "?q=OLIVE");

      expect(res.status).toBe(200);
      expect(ours(res.body)).toEqual([rows.oliveOil]);
    });

    it("matches a Turkish alias that isn't in the name", async () => {
      const res = await list(alice, "?q=yumurta");

      expect(res.status).toBe(200);
      expect(ours(res.body)).toEqual([rows.egg]);
    });

    it("matches a Turkish alias in capitals", async () => {
      const res = await list(alice, "?q=YUMURTA");

      expect(res.status).toBe(200);
      expect(ours(res.body)).toEqual([rows.egg]);
    });

    it.each(["ıspanak", "ISPANAK", "ispanak", "Ispanak"])("folds ı and I so %s finds the alias", async (q) => {
      const res = await list(alice, `?q=${encodeURIComponent(q)}`);

      expect(res.status).toBe(200);
      expect(ours(res.body)).toEqual([rows.spinach]);
    });

    it("returns an empty list when nothing matches", async () => {
      const res = await list(alice, `?q=${encodeURIComponent(`zeppolt nothing ${TOKEN}`)}`);

      expect(res.status).toBe(200);
      expect(ours(res.body)).toEqual([]);
    });

    it("returns 400 for a repeated q", async () => {
      const res = await list(alice, "?q=a&q=b");

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "q must be a string" });
    });
  });

  describe("group", () => {
    it.each([
      ["PROTEIN", ["egg"]],
      // Any entry with the nutrient, main or not: avocado and oats show under FIBER.
      ["FIBER", ["avocado", "oats", "spinach"]],
      ["HEALTHY_FAT", ["avocado", "oliveOil"]],
      // CARB is the main group only.
      ["CARB", ["oats", "rice"]],
    ])("%s returns the matching entries sorted by name", async (group, keys) => {
      const res = await list(alice, `?group=${group}`);

      expect(res.status).toBe(200);
      expect(ours(res.body)).toEqual(keys.map((key) => rows[key]));
    });

    it("leaves seasonings out of every group", async () => {
      for (const group of ["PROTEIN", "FIBER", "HEALTHY_FAT", "CARB"]) {
        const res = await list(alice, `?group=${group}`);
        expect(res.body.map((row: Row) => row.id)).not.toContain(rows.salt.id);
      }
    });

    it("combines with q", async () => {
      const res = await list(alice, `?q=${TOKEN}&group=FIBER`);

      expect(res.status).toBe(200);
      expect(ours(res.body)).toEqual([rows.avocado, rows.oats, rows.spinach]);
    });

    it("combines with a q that only an alias matches", async () => {
      const fiber = await list(alice, "?q=ispanak&group=FIBER");
      const protein = await list(alice, "?q=ispanak&group=PROTEIN");

      expect(ours(fiber.body)).toEqual([rows.spinach]);
      expect(ours(protein.body)).toEqual([]);
    });

    it.each(["protein", "NUTS", "", "PROTEIN,FIBER"])("returns 400 for group=%s", async (group) => {
      const res = await list(alice, `?group=${encodeURIComponent(group)}`);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: GROUP_ERROR });
    });

    it("returns 400 for a repeated group", async () => {
      const res = await list(alice, "?group=FIBER&group=CARB");

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: GROUP_ERROR });
    });
  });
});

describe("GET /ingredients/:id", () => {
  let aliceBread: string;
  let alicePie: string;
  let bobRecipe: string;

  // Lines are written directly so the matcher can't link them to anything else.
  async function addLine(recipeId: string, position: number, ingredientId: string | null) {
    await prisma.recipeIngredient.create({
      data: { recipeId, position, text: `line ${position}`, ingredientId },
    });
  }

  beforeAll(async () => {
    // Created out of title order so the sort shows.
    aliceBread = await createRecipe(alice, { title: "Zeppolt bread", ingredients: [] });
    alicePie = await createRecipe(alice, { title: "Apple zeppolt pie", ingredients: [] });
    const aliceOther = await createRecipe(alice, { title: "Mango zeppolt salad", ingredients: [] });
    bobRecipe = await createRecipe(bob, { title: "Bob's zeppolt omelette", ingredients: [] });

    // The bread links the egg on two lines; it must still show once.
    await addLine(aliceBread, 0, rows.egg.id);
    await addLine(aliceBread, 1, null);
    await addLine(aliceBread, 2, rows.egg.id);
    await addLine(alicePie, 0, rows.egg.id);
    await addLine(aliceOther, 0, rows.rice.id);
    await addLine(bobRecipe, 0, rows.egg.id);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).get(`/ingredients/${rows.egg.id}`);

    expect(res.status).toBe(401);
  });

  it("returns the entry with the viewer's linked recipes, each once, sorted by title", async () => {
    const res = await request(app).get(`/ingredients/${rows.egg.id}`).set(authed(alice));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: rows.egg.id,
      name: rows.egg.name,
      mainGroup: "PROTEIN",
      nutrients: ["PROTEIN"],
      description: "A made-up egg.",
      fdcId: EGG_FDC_ID,
      recipes: [
        { id: alicePie, title: "Apple zeppolt pie" },
        { id: aliceBread, title: "Zeppolt bread" },
      ],
    });
  });

  it("never shows another user's recipe", async () => {
    const res = await request(app).get(`/ingredients/${rows.egg.id}`).set(authed(bob));

    expect(res.status).toBe(200);
    expect(res.body.recipes).toEqual([{ id: bobRecipe, title: "Bob's zeppolt omelette" }]);
  });

  it("returns fdcId as a number when the entry has one", async () => {
    const res = await request(app).get(`/ingredients/${rows.egg.id}`).set(authed(alice));

    expect(res.status).toBe(200);
    expect(typeof res.body.fdcId).toBe("number");
    expect(res.body.fdcId).toBe(EGG_FDC_ID);
  });

  it("returns an empty recipe list and null description and fdcId when nothing links to it", async () => {
    const res = await request(app).get(`/ingredients/${rows.salt.id}`).set(authed(alice));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: rows.salt.id,
      name: rows.salt.name,
      mainGroup: null,
      nutrients: [],
      description: null,
      fdcId: null,
      recipes: [],
    });
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app).get(`/ingredients/no-such-${TOKEN}`).set(authed(alice));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Ingredient not found" });
  });
});
