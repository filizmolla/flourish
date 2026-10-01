import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { authed, createAttempt, createRecipe, createTestUser, deleteTestUsers, TestUser } from "./helpers.js";

// Phase 5 Slice A: a recipe's ingredient lines live in recipe_ingredient.
// The API still takes `ingredients: string[]` and sends it back alongside
// `lines` (each with its catalog link), and the old recipe.ingredients column
// is kept in sync until a later migration drops it.

const SAME_AS_RECIPE = "This attempt is the same as the recipe, so there is nothing to save";

let alice: TestUser;
let bob: TestUser;
// Catalog rows are global, not owned by a test user, so they're cleaned up by id.
const ingredientIds: string[] = [];

async function createIngredient(name: string): Promise<string> {
  const unique = `${name} ${randomUUID()}`;
  const ingredient = await prisma.ingredient.create({
    data: { name: unique, normalizedName: unique.toLowerCase(), aliases: [], nutrients: [] },
  });
  ingredientIds.push(ingredient.id);
  return ingredient.id;
}

function linesOf(recipeId: string) {
  return prisma.recipeIngredient.findMany({
    where: { recipeId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, text: true, ingredientId: true },
  });
}

async function oldColumnOf(recipeId: string): Promise<string[]> {
  const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId }, select: { ingredients: true } });
  return recipe.ingredients;
}

async function link(recipeId: string, position: number, ingredientId: string) {
  await prisma.recipeIngredient.update({
    where: { recipeId_position: { recipeId, position } },
    data: { ingredientId },
  });
}

function patchIngredients(user: TestUser, recipeId: string, ingredients: string[]) {
  return request(app).patch(`/recipes/${recipeId}`).set(authed(user)).send({ ingredients });
}

beforeAll(async () => {
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
});

afterAll(async () => {
  await deleteTestUsers(alice, bob);
  await prisma.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
  await prisma.$disconnect();
});

describe("POST /recipes writes the lines", () => {
  it("creates one unlinked line per ingredient, positions 0..n-1, and fills the old column", async () => {
    const ingredients = ["2 cups flour", "1 egg", "1 cup milk"];
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ title: "Pancakes", ingredients, instructions: "Mix." });

    expect(res.status).toBe(201);
    expect(res.body.ingredients).toEqual(ingredients);
    expect(res.body.lines).toEqual([
      { position: 0, text: "2 cups flour", linkSetByOwner: false, ingredient: null },
      { position: 1, text: "1 egg", linkSetByOwner: false, ingredient: null },
      { position: 2, text: "1 cup milk", linkSetByOwner: false, ingredient: null },
    ]);
    const lines = await linesOf(res.body.id);
    expect(lines.map(({ position, text, ingredientId }) => ({ position, text, ingredientId }))).toEqual([
      { position: 0, text: "2 cups flour", ingredientId: null },
      { position: 1, text: "1 egg", ingredientId: null },
      { position: 2, text: "1 cup milk", ingredientId: null },
    ]);
    expect(await oldColumnOf(res.body.id)).toEqual(ingredients);
  });

  it("creates no lines for an empty ingredient list", async () => {
    const recipeId = await createRecipe(alice, { ingredients: [] });

    expect(await linesOf(recipeId)).toEqual([]);
    expect(await oldColumnOf(recipeId)).toEqual([]);
  });

  it("keeps duplicate and heading lines as sent", async () => {
    const ingredients = ["# Sauce", "1 tsp salt", "# Dough", "1 tsp salt"];
    const recipeId = await createRecipe(alice, { ingredients });

    expect((await linesOf(recipeId)).map((line) => line.text)).toEqual(ingredients);
  });
});

describe("GET /recipes orders ingredients by position", () => {
  let recipeId: string;

  beforeAll(async () => {
    recipeId = await createRecipe(alice, { title: "Out of order", ingredients: [] });
    // Inserted in a different order than their positions, so any order that
    // doesn't come from `position` shows up.
    for (const [position, text] of [
      [2, "third"],
      [0, "first"],
      [1, "second"],
    ] as const) {
      await prisma.recipeIngredient.create({ data: { recipeId, position, text } });
    }
  });

  it("returns them in position order on the detail", async () => {
    const res = await request(app).get(`/recipes/${recipeId}`).set(authed(alice));

    expect(res.status).toBe(200);
    expect(res.body.ingredients).toEqual(["first", "second", "third"]);
    expect(res.body.lines.map(({ position, text }: { position: number; text: string }) => ({ position, text }))).toEqual([
      { position: 0, text: "first" },
      { position: 1, text: "second" },
      { position: 2, text: "third" },
    ]);
  });

  it("returns them in position order in the list, lines included", async () => {
    const res = await request(app).get("/recipes").set(authed(alice));

    expect(res.status).toBe(200);
    const recipe = res.body.find((r: { id: string }) => r.id === recipeId);
    expect(recipe.ingredients).toEqual(["first", "second", "third"]);
    expect(recipe.lines.map((line: { text: string }) => line.text)).toEqual(["first", "second", "third"]);
  });

  it("reads the lines, not the old column", async () => {
    // The old column is stale ([] from create); the response must not use it.
    expect(await oldColumnOf(recipeId)).toEqual([]);
    const res = await request(app).get(`/recipes/${recipeId}`).set(authed(alice));
    expect(res.body.ingredients).toHaveLength(3);
  });
});

describe("PATCH /recipes/:id with ingredients", () => {
  it("leaves the lines untouched when the ingredients are the same", async () => {
    const ingredients = ["1 onion", "2 carrots"];
    const recipeId = await createRecipe(alice, { ingredients });
    const ingredientId = await createIngredient("onion");
    await link(recipeId, 0, ingredientId);
    const before = await linesOf(recipeId);

    const res = await request(app)
      .patch(`/recipes/${recipeId}`)
      .set(authed(alice))
      .send({ title: "Renamed", ingredients });

    expect(res.status).toBe(200);
    expect(res.body.ingredients).toEqual(ingredients);
    expect(await linesOf(recipeId)).toEqual(before);
  });

  it("leaves the lines untouched when ingredients is omitted", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["1 onion"] });
    const before = await linesOf(recipeId);

    const res = await request(app).patch(`/recipes/${recipeId}`).set(authed(alice)).send({ title: "Renamed" });

    expect(res.status).toBe(200);
    expect(res.body.ingredients).toEqual(["1 onion"]);
    expect(await linesOf(recipeId)).toEqual(before);
  });

  it("replaces the lines, renumbers positions and updates the old column when they change", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["a", "b", "c"] });
    const oldIds = (await linesOf(recipeId)).map((line) => line.id);

    const res = await patchIngredients(alice, recipeId, ["c", "a"]);

    expect(res.status).toBe(200);
    expect(res.body.ingredients).toEqual(["c", "a"]);
    const lines = await linesOf(recipeId);
    expect(lines.map(({ position, text }) => ({ position, text }))).toEqual([
      { position: 0, text: "c" },
      { position: 1, text: "a" },
    ]);
    for (const line of lines) expect(oldIds).not.toContain(line.id);
    expect(await prisma.recipeIngredient.count({ where: { id: { in: oldIds } } })).toBe(0);
    expect(await oldColumnOf(recipeId)).toEqual(["c", "a"]);
  });

  it("clears the lines when ingredients becomes empty", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["a", "b"] });

    const res = await patchIngredients(alice, recipeId, []);

    expect(res.status).toBe(200);
    expect(res.body.ingredients).toEqual([]);
    expect(await linesOf(recipeId)).toEqual([]);
    expect(await oldColumnOf(recipeId)).toEqual([]);
  });

  describe("catalog links", () => {
    it("keeps a moved line's link at its new position", async () => {
      const recipeId = await createRecipe(alice, { ingredients: ["1 tsp salt", "2 eggs"] });
      const eggId = await createIngredient("egg");
      await link(recipeId, 1, eggId);

      const res = await patchIngredients(alice, recipeId, ["1 tsp salt", "1 cup milk", "2 eggs"]);

      expect(res.status).toBe(200);
      const lines = await linesOf(recipeId);
      expect(lines.map(({ position, text, ingredientId }) => ({ position, text, ingredientId }))).toEqual([
        { position: 0, text: "1 tsp salt", ingredientId: null },
        { position: 1, text: "1 cup milk", ingredientId: null },
        { position: 2, text: "2 eggs", ingredientId: eggId },
      ]);
    });

    it("drops the link of a line whose text changed", async () => {
      const recipeId = await createRecipe(alice, { ingredients: ["2 eggs", "1 onion"] });
      const eggId = await createIngredient("egg");
      const onionId = await createIngredient("onion");
      await link(recipeId, 0, eggId);
      await link(recipeId, 1, onionId);

      const res = await patchIngredients(alice, recipeId, ["3 eggs", "1 onion"]);

      expect(res.status).toBe(200);
      const lines = await linesOf(recipeId);
      expect(lines.map(({ text, ingredientId }) => ({ text, ingredientId }))).toEqual([
        { text: "3 eggs", ingredientId: null },
        { text: "1 onion", ingredientId: onionId },
      ]);
    });

    it("lends each old line's link once, in order, across duplicate texts", async () => {
      const recipeId = await createRecipe(alice, { ingredients: ["1 tsp salt", "1 tsp salt"] });
      const firstId = await createIngredient("salt a");
      const secondId = await createIngredient("salt b");
      await link(recipeId, 0, firstId);
      await link(recipeId, 1, secondId);

      const res = await patchIngredients(alice, recipeId, ["1 tsp salt", "pepper", "1 tsp salt", "1 tsp salt"]);

      expect(res.status).toBe(200);
      const lines = await linesOf(recipeId);
      expect(lines.map(({ text, ingredientId }) => ({ text, ingredientId }))).toEqual([
        { text: "1 tsp salt", ingredientId: firstId },
        { text: "pepper", ingredientId: null },
        { text: "1 tsp salt", ingredientId: secondId },
        { text: "1 tsp salt", ingredientId: null },
      ]);
    });

    it("keeps only the first link when duplicates shrink to one", async () => {
      const recipeId = await createRecipe(alice, { ingredients: ["1 tsp salt", "1 tsp salt"] });
      const firstId = await createIngredient("salt a");
      const secondId = await createIngredient("salt b");
      await link(recipeId, 0, firstId);
      await link(recipeId, 1, secondId);

      const res = await patchIngredients(alice, recipeId, ["1 tsp salt"]);

      expect(res.status).toBe(200);
      const lines = await linesOf(recipeId);
      expect(lines.map(({ text, ingredientId }) => ({ text, ingredientId }))).toEqual([
        { text: "1 tsp salt", ingredientId: firstId },
      ]);
    });
  });

  it("writes the old lines, with their links, into attempts with a null snapshot", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 eggs", "1 tsp salt"] });
    const eggId = await createIngredient("egg");
    await link(recipeId, 0, eggId);
    const attemptId = await createAttempt(alice, recipeId, {});
    const snapshot = [{ text: "4 eggs" }];
    const tweakedId = await createAttempt(alice, recipeId, { ingredients: snapshot });

    const res = await patchIngredients(alice, recipeId, ["3 eggs", "1 tsp salt"]);

    expect(res.status).toBe(200);
    const attempt = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.ingredients).toStrictEqual([{ text: "2 eggs", ingredientId: eggId }, { text: "1 tsp salt" }]);
    // A filled-in snapshot never marks the attempt as changed while cooking.
    expect(attempt.tweaked).toBe(false);
    // An attempt that already has its own snapshot keeps it.
    const tweaked = await prisma.attempt.findUniqueOrThrow({ where: { id: tweakedId } });
    expect(tweaked.ingredients).toStrictEqual(snapshot);
  });

  it("returns 404 for another user's recipe and leaves its lines alone", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 eggs", "1 onion"] });
    const eggId = await createIngredient("egg");
    await link(recipeId, 0, eggId);
    const before = await linesOf(recipeId);

    const res = await patchIngredients(bob, recipeId, ["stolen"]);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Recipe not found" });
    expect(await linesOf(recipeId)).toEqual(before);
    expect(await oldColumnOf(recipeId)).toEqual(["2 eggs", "1 onion"]);
  });

  it("returns 401 without a token and leaves the lines alone", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 eggs"] });
    const before = await linesOf(recipeId);

    const res = await request(app).patch(`/recipes/${recipeId}`).send({ ingredients: ["changed"] });

    expect(res.status).toBe(401);
    expect(await linesOf(recipeId)).toEqual(before);
  });

  it("returns 400 for non-string ingredients and leaves the lines alone", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 eggs"] });
    const before = await linesOf(recipeId);

    const res = await request(app)
      .patch(`/recipes/${recipeId}`)
      .set(authed(alice))
      .send({ ingredients: ["ok", 3] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "ingredients must be an array of strings" });
    expect(await linesOf(recipeId)).toEqual(before);
  });
});

describe("the matcher links lines to the catalog", () => {
  // Made-up words, so no other test file's lines match them and these lines
  // match no other test file's catalog rows (the matcher reads the whole table).
  const QUORZEL = "quorzel";
  const BLINTVAR = "blintvar";
  let quorzelId: string;
  let blintvarId: string;

  async function createCatalogRow(normalizedName: string, aliases: string[]): Promise<string> {
    // A row left over from an interrupted run would break the unique name.
    await prisma.ingredient.deleteMany({ where: { normalizedName } });
    const ingredient = await prisma.ingredient.create({
      data: { name: normalizedName, normalizedName, aliases, nutrients: [] },
    });
    ingredientIds.push(ingredient.id);
    return ingredient.id;
  }

  async function linksOf(recipeId: string) {
    return (await linesOf(recipeId)).map(({ text, ingredientId }) => ({ text, ingredientId }));
  }

  beforeAll(async () => {
    quorzelId = await createCatalogRow(QUORZEL, []);
    blintvarId = await createCatalogRow(BLINTVAR, ["blintvar tozu"]);
  });

  it("POST links matching lines and leaves headings and unknown lines unlinked", async () => {
    const recipeId = await createRecipe(alice, {
      ingredients: ["# Quorzel sauce", "2 quorzels", "1 tsp blintvar tozu", "1 cup mystery"],
    });

    expect(await linksOf(recipeId)).toEqual([
      { text: "# Quorzel sauce", ingredientId: null },
      { text: "2 quorzels", ingredientId: quorzelId },
      { text: "1 tsp blintvar tozu", ingredientId: blintvarId },
      { text: "1 cup mystery", ingredientId: null },
    ]);
  });

  it("PATCH links a newly added line and returns the updated lines", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 quorzels"] });

    const res = await patchIngredients(alice, recipeId, ["2 quorzels", "1 blintvar"]);

    expect(res.status).toBe(200);
    expect(res.body.ingredients).toEqual(["2 quorzels", "1 blintvar"]);
    expect(res.body.lines).toEqual([
      {
        position: 0,
        text: "2 quorzels",
        linkSetByOwner: false,
        ingredient: { id: quorzelId, name: QUORZEL, mainGroup: null, nutrients: [] },
      },
      {
        position: 1,
        text: "1 blintvar",
        linkSetByOwner: false,
        ingredient: { id: blintvarId, name: BLINTVAR, mainGroup: null, nutrients: [] },
      },
    ]);
    expect(await linksOf(recipeId)).toEqual([
      { text: "2 quorzels", ingredientId: quorzelId },
      { text: "1 blintvar", ingredientId: blintvarId },
    ]);
  });

  it("PATCH relinks a line whose text changed", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 quorzels", "1 cup mystery"] });
    expect((await linesOf(recipeId))[0].ingredientId).toBe(quorzelId);

    const res = await patchIngredients(alice, recipeId, ["2 blintvar", "1 cup mystery"]);

    expect(res.status).toBe(200);
    expect(await linksOf(recipeId)).toEqual([
      { text: "2 blintvar", ingredientId: blintvarId },
      { text: "1 cup mystery", ingredientId: null },
    ]);
  });

  it("PATCH unlinks a line changed to text that matches nothing", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 quorzels"] });

    const res = await patchIngredients(alice, recipeId, ["2 mysteries"]);

    expect(res.status).toBe(200);
    expect(await linksOf(recipeId)).toEqual([{ text: "2 mysteries", ingredientId: null }]);
  });

  it("PATCH keeps an unchanged line's link rather than matching it again", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 quorzels", "1 cup mystery"] });
    // Linked by hand to something the matcher wouldn't pick.
    await link(recipeId, 0, blintvarId);

    const res = await patchIngredients(alice, recipeId, ["2 quorzels", "1 blintvar"]);

    expect(res.status).toBe(200);
    expect(await linksOf(recipeId)).toEqual([
      { text: "2 quorzels", ingredientId: blintvarId },
      { text: "1 blintvar", ingredientId: blintvarId },
    ]);
  });

  it("PATCH keeps an unchanged line unlinked when it was unlinked", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 quorzels", "1 cup mystery"] });
    await prisma.recipeIngredient.update({
      where: { recipeId_position: { recipeId, position: 0 } },
      data: { ingredientId: null },
    });

    const res = await patchIngredients(alice, recipeId, ["2 quorzels", "1 blintvar"]);

    expect(res.status).toBe(200);
    expect(await linksOf(recipeId)).toEqual([
      { text: "2 quorzels", ingredientId: null },
      { text: "1 blintvar", ingredientId: blintvarId },
    ]);
  });
});

describe("deleting", () => {
  it("deleting a recipe deletes its lines", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["a", "b"] });
    expect(await linesOf(recipeId)).toHaveLength(2);

    const res = await request(app).delete(`/recipes/${recipeId}`).set(authed(alice));

    expect(res.status).toBe(204);
    expect(await prisma.recipeIngredient.count({ where: { recipeId } })).toBe(0);
  });

  it("deleting a catalog ingredient unlinks its lines but keeps them", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 eggs", "1 onion"] });
    const eggId = await createIngredient("egg");
    await link(recipeId, 0, eggId);

    await prisma.ingredient.delete({ where: { id: eggId } });

    const lines = await linesOf(recipeId);
    expect(lines.map(({ text, ingredientId }) => ({ text, ingredientId }))).toEqual([
      { text: "2 eggs", ingredientId: null },
      { text: "1 onion", ingredientId: null },
    ]);
    const res = await request(app).get(`/recipes/${recipeId}`).set(authed(alice));
    expect(res.body.ingredients).toEqual(["2 eggs", "1 onion"]);
  });
});

describe("fork detection compares against the lines", () => {
  const forkBody = { title: "Fork", ingredients: ["x"], instructions: "Cook." };

  it("returns 409 for an attempt identical to the lines, even when the old column differs", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 eggs", "1 onion"], instructions: "Cook." });
    const attemptId = await createAttempt(alice, recipeId, {
      ingredients: [{ text: "2 eggs" }, { text: "1 onion" }],
    });
    // A stale old column must not make the attempt look different.
    await prisma.recipe.update({ where: { id: recipeId }, data: { ingredients: ["something else"] } });

    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...forkBody, forkedFromAttemptId: attemptId });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: SAME_AS_RECIPE });
  });

  it("returns 409 for a snapshot filled in by an edit that was then reverted", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 eggs", "1 onion"], instructions: "Cook." });
    const eggId = await createIngredient("egg");
    await link(recipeId, 0, eggId);
    const attemptId = await createAttempt(alice, recipeId, {});
    expect((await patchIngredients(alice, recipeId, ["3 eggs"])).status).toBe(200);
    expect((await patchIngredients(alice, recipeId, ["2 eggs", "1 onion"])).status).toBe(200);

    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...forkBody, forkedFromAttemptId: attemptId });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: SAME_AS_RECIPE });
  });

  it("allows a fork when the attempt differs from the lines, even when it matches the old column", async () => {
    const recipeId = await createRecipe(alice, { ingredients: ["2 eggs", "1 onion"], instructions: "Cook." });
    const attemptId = await createAttempt(alice, recipeId, { ingredients: [{ text: "2 eggs" }] });
    await prisma.recipe.update({ where: { id: recipeId }, data: { ingredients: ["2 eggs"] } });

    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...forkBody, forkedFromAttemptId: attemptId });

    expect(res.status).toBe(201);
  });
});
