import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { authed, createRecipe, createTestUser, deleteTestUsers, TestUser } from "./helpers.js";

// The owner fixes a line's catalog link: PATCH /recipes/:id/lines/:position,
// and a later recipe edit keeps that choice on unchanged lines.

// Made-up words, so no other test file's lines match these catalog rows and
// these lines match no other file's rows (the matcher reads the whole table).
const ZAMFRICK = "zamfrick";
const TROVELIN = "trovelin";

let alice: TestUser;
let bob: TestUser;
let zamfrickId: string;
let trovelinId: string;
const ingredientIds: string[] = [];

async function createCatalogRow(normalizedName: string): Promise<string> {
  // A row left over from an interrupted run would break the unique name.
  await prisma.ingredient.deleteMany({ where: { normalizedName } });
  const ingredient = await prisma.ingredient.create({
    data: {
      name: normalizedName,
      normalizedName,
      // Filled in so a test can check responses leave them out.
      aliases: [`${normalizedName} tozu`],
      description: `Made-up ${normalizedName}`,
      fdcId: 2_000_000_000 + Math.floor(Math.random() * 100_000_000),
      mainGroup: "PROTEIN",
      nutrients: ["PROTEIN"],
    },
  });
  ingredientIds.push(ingredient.id);
  return ingredient.id;
}

async function linksOf(recipeId: string) {
  return prisma.recipeIngredient.findMany({
    where: { recipeId },
    orderBy: { position: "asc" },
    select: { position: true, text: true, ingredientId: true, linkSetByOwner: true },
  });
}

function setLink(user: TestUser | null, recipeId: string, position: number | string, body: object) {
  const req = request(app).patch(`/recipes/${recipeId}/lines/${position}`);
  return (user ? req.set(authed(user)) : req).send(body);
}

function patchIngredients(user: TestUser, recipeId: string, ingredients: string[]) {
  return request(app).patch(`/recipes/${recipeId}`).set(authed(user)).send({ ingredients });
}

beforeAll(async () => {
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
  zamfrickId = await createCatalogRow(ZAMFRICK);
  trovelinId = await createCatalogRow(TROVELIN);
});

afterAll(async () => {
  await deleteTestUsers(alice, bob);
  await prisma.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
  await prisma.$disconnect();
});

describe("PATCH /recipes/:id/lines/:position", () => {
  it("new lines start with linkSetByOwner false", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks", "1 cup mystery"] });

    expect(await linksOf(recipeId)).toEqual([
      { position: 0, text: "2 zamfricks", ingredientId: zamfrickId, linkSetByOwner: false },
      { position: 1, text: "1 cup mystery", ingredientId: null, linkSetByOwner: false },
    ]);
  });

  it("links a line to a catalog entry and marks it as set by the owner", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks", "1 cup mystery"] });

    const res = await setLink(alice, recipeId, 1, { ingredientId: trovelinId });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      position: 1,
      text: "1 cup mystery",
      linkSetByOwner: true,
      ingredient: { id: trovelinId, name: TROVELIN, mainGroup: "PROTEIN", nutrients: ["PROTEIN"] },
    });
    expect(await linksOf(recipeId)).toEqual([
      { position: 0, text: "2 zamfricks", ingredientId: zamfrickId, linkSetByOwner: false },
      { position: 1, text: "1 cup mystery", ingredientId: trovelinId, linkSetByOwner: true },
    ]);
  });

  it("relinks an already linked line to a different entry", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks"] });

    const res = await setLink(alice, recipeId, 0, { ingredientId: trovelinId });

    expect(res.status).toBe(200);
    expect(res.body.ingredient.id).toBe(trovelinId);
    expect(await linksOf(recipeId)).toEqual([
      { position: 0, text: "2 zamfricks", ingredientId: trovelinId, linkSetByOwner: true },
    ]);
  });

  it("unlinks a line with null and marks it as set by the owner", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks"] });

    const res = await setLink(alice, recipeId, 0, { ingredientId: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ position: 0, text: "2 zamfricks", linkSetByOwner: true, ingredient: null });
    expect(await linksOf(recipeId)).toEqual([
      { position: 0, text: "2 zamfricks", ingredientId: null, linkSetByOwner: true },
    ]);
  });

  it("allows unlinking a section heading", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["# Zamfrick sauce", "2 zamfricks"] });

    const res = await setLink(alice, recipeId, 0, { ingredientId: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ position: 0, text: "# Zamfrick sauce", linkSetByOwner: true, ingredient: null });
  });

  it("returns 400 when linking a section heading and leaves it alone", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["# Zamfrick sauce", "2 zamfricks"] });
    const before = await linksOf(recipeId);

    const res = await setLink(alice, recipeId, 0, { ingredientId: zamfrickId });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "A section heading can't be linked" });
    expect(await linksOf(recipeId)).toEqual(before);
  });

  it("returns 400 for an id that isn't in the catalog and leaves the line alone", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks"] });
    const before = await linksOf(recipeId);

    const res = await setLink(alice, recipeId, 0, { ingredientId: "no-such-ingredient" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "ingredientId is not in the catalog" });
    expect(await linksOf(recipeId)).toEqual(before);
  });

  it.each([
    ["missing", {}],
    ["a number", { ingredientId: 5 }],
    ["an empty string", { ingredientId: "" }],
    ["an object", { ingredientId: { id: "x" } }],
  ])("returns 400 when ingredientId is %s", async (_label, body) => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks"] });
    const before = await linksOf(recipeId);

    const res = await setLink(alice, recipeId, 0, body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "ingredientId must be a string or null" });
    expect(await linksOf(recipeId)).toEqual(before);
  });

  it.each(["-1", "1.5", "abc", "1e2", "99999999999999999999"])(
    "returns 400 for position %s",
    async (position) => {
      const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks"] });

      const res = await setLink(alice, recipeId, position, { ingredientId: null });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "position must be a non-negative integer" });
    },
  );

  it("returns 404 Line not found for a position past the last line", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks", "1 cup mystery"] });

    const res = await setLink(alice, recipeId, 2, { ingredientId: null });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Line not found" });
  });

  it("returns 404 Line not found for a recipe with no lines", async () => {
    const recipeId = await createRecipe(alice, { ingredients: [] });

    const res = await setLink(alice, recipeId, 0, { ingredientId: null });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Line not found" });
  });

  it("returns 404 Recipe not found for a missing recipe", async () => {
    const res = await setLink(alice, "no-such-recipe", 0, { ingredientId: null });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Recipe not found" });
  });

  it("returns 404 Recipe not found for another user's recipe and leaves their line alone", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks"] });
    const before = await linksOf(recipeId);

    const unlink = await setLink(bob, recipeId, 0, { ingredientId: null });
    const relink = await setLink(bob, recipeId, 0, { ingredientId: trovelinId });

    for (const res of [unlink, relink]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Recipe not found" });
    }
    expect(await linksOf(recipeId)).toEqual(before);
  });

  it("returns Recipe not found, not Line not found, for another user's recipe at a missing position", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks"] });

    const res = await setLink(bob, recipeId, 5, { ingredientId: null });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Recipe not found" });
  });

  it("returns 401 without a token and leaves the line alone", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks"] });
    const before = await linksOf(recipeId);

    const res = await setLink(null, recipeId, 0, { ingredientId: null });

    expect(res.status).toBe(401);
    expect(await linksOf(recipeId)).toEqual(before);
  });

});

describe("recipe responses carry each line's link", () => {
  const zamfrick = () => ({ id: zamfrickId, name: ZAMFRICK, mainGroup: "PROTEIN", nutrients: ["PROTEIN"] });
  const trovelin = () => ({ id: trovelinId, name: TROVELIN, mainGroup: "PROTEIN", nutrients: ["PROTEIN"] });

  it("sends a matched line's ingredient (id, name, mainGroup, nutrients only), null for headings and unmatched lines", async () => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ title: "Zamfrick stew", ingredients: ["# Zamfrick sauce", "2 zamfricks", "1 cup mystery"], instructions: "Cook." });

    expect(res.status).toBe(201);
    // toEqual fails on extra keys, so aliases, description, fdcId etc. must be absent.
    expect(res.body.lines).toEqual([
      { position: 0, text: "# Zamfrick sauce", linkSetByOwner: false, ingredient: null },
      { position: 1, text: "2 zamfricks", linkSetByOwner: false, ingredient: zamfrick() },
      { position: 2, text: "1 cup mystery", linkSetByOwner: false, ingredient: null },
    ]);
  });

  it("GET /recipes/:id reflects the owner's link and unlink, with linkSetByOwner true", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks", "1 cup mystery"] });
    expect((await setLink(alice, recipeId, 0, { ingredientId: null })).status).toBe(200);
    expect((await setLink(alice, recipeId, 1, { ingredientId: trovelinId })).status).toBe(200);

    const res = await request(app).get(`/recipes/${recipeId}`).set(authed(alice));

    expect(res.status).toBe(200);
    expect(res.body.ingredients).toEqual(["2 zamfricks", "1 cup mystery"]);
    expect(res.body.lines).toEqual([
      { position: 0, text: "2 zamfricks", linkSetByOwner: true, ingredient: null },
      { position: 1, text: "1 cup mystery", linkSetByOwner: true, ingredient: trovelin() },
    ]);
  });
});

describe("PATCH /recipes/:id keeps the owner's link choices", () => {
  it("keeps a line the owner unlinked unlinked when another line is edited", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks", "1 cup mystery"] });
    expect((await setLink(alice, recipeId, 0, { ingredientId: null })).status).toBe(200);

    const res = await patchIngredients(alice, recipeId, ["2 zamfricks", "1 trovelin"]);

    expect(res.status).toBe(200);
    expect(await linksOf(recipeId)).toEqual([
      { position: 0, text: "2 zamfricks", ingredientId: null, linkSetByOwner: true },
      { position: 1, text: "1 trovelin", ingredientId: trovelinId, linkSetByOwner: false },
    ]);
  });

  it("keeps the owner's different link when another line is edited", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks", "1 cup mystery"] });
    expect((await setLink(alice, recipeId, 0, { ingredientId: trovelinId })).status).toBe(200);

    const res = await patchIngredients(alice, recipeId, ["2 zamfricks", "1 cup more mystery"]);

    expect(res.status).toBe(200);
    expect(await linksOf(recipeId)).toEqual([
      { position: 0, text: "2 zamfricks", ingredientId: trovelinId, linkSetByOwner: true },
      { position: 1, text: "1 cup more mystery", ingredientId: null, linkSetByOwner: false },
    ]);
  });

  it("keeps the owner's choice on a line that moved", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks", "1 cup mystery"] });
    expect((await setLink(alice, recipeId, 0, { ingredientId: null })).status).toBe(200);

    const res = await patchIngredients(alice, recipeId, ["1 trovelin", "1 cup mystery", "2 zamfricks"]);

    expect(res.status).toBe(200);
    expect(await linksOf(recipeId)).toEqual([
      { position: 0, text: "1 trovelin", ingredientId: trovelinId, linkSetByOwner: false },
      { position: 1, text: "1 cup mystery", ingredientId: null, linkSetByOwner: false },
      { position: 2, text: "2 zamfricks", ingredientId: null, linkSetByOwner: true },
    ]);
  });

  it("matches an owner-set line again, with the flag cleared, once its text is edited", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks", "1 cup mystery"] });
    expect((await setLink(alice, recipeId, 0, { ingredientId: trovelinId })).status).toBe(200);

    const res = await patchIngredients(alice, recipeId, ["3 zamfricks", "1 cup mystery"]);

    expect(res.status).toBe(200);
    expect(await linksOf(recipeId)).toEqual([
      { position: 0, text: "3 zamfricks", ingredientId: zamfrickId, linkSetByOwner: false },
      { position: 1, text: "1 cup mystery", ingredientId: null, linkSetByOwner: false },
    ]);
  });

  it("lends the owner's choice to the matching duplicate, in order", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks", "2 zamfricks"] });
    expect((await setLink(alice, recipeId, 1, { ingredientId: trovelinId })).status).toBe(200);

    const res = await patchIngredients(alice, recipeId, ["2 zamfricks", "# Side", "2 zamfricks"]);

    expect(res.status).toBe(200);
    expect(await linksOf(recipeId)).toEqual([
      { position: 0, text: "2 zamfricks", ingredientId: zamfrickId, linkSetByOwner: false },
      { position: 1, text: "# Side", ingredientId: null, linkSetByOwner: false },
      { position: 2, text: "2 zamfricks", ingredientId: trovelinId, linkSetByOwner: true },
    ]);
  });

  it("leaves owner-set lines untouched when the ingredients are unchanged", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 zamfricks"] });
    expect((await setLink(alice, recipeId, 0, { ingredientId: null })).status).toBe(200);
    const before = await linksOf(recipeId);

    const res = await request(app)
      .patch(`/recipes/${recipeId}`)
      .set(authed(alice))
      .send({ title: "Renamed", ingredients: ["2 zamfricks"] });

    expect(res.status).toBe(200);
    expect(await linksOf(recipeId)).toEqual(before);
  });
});
