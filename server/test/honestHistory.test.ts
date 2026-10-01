import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { Prisma } from "../src/generated/prisma/client.js";
import { prisma } from "../src/prisma.js";
import { authed, createTestUser, deleteTestUsers, ingredientsIsSqlNull, TestUser } from "./helpers.js";

// Honest history: a recipe edit that changes ingredients or instructions first
// writes the old version into that recipe's attempts whose snapshot is null.

const OLD_INGREDIENTS = ["1 onion", "2 carrots"];
const OLD_INSTRUCTIONS = "Chop.\nSimmer.";

const baseRecipe = {
  title: "Test Soup",
  ingredients: OLD_INGREDIENTS,
  instructions: OLD_INSTRUCTIONS,
};

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
});

afterAll(async () => {
  await deleteTestUsers(alice, bob);
  await prisma.$disconnect();
});

async function createRecipe(user: TestUser): Promise<string> {
  const res = await request(app).post("/recipes").set(authed(user)).send(baseRecipe);
  if (res.status !== 201) throw new Error(`Recipe create failed (${res.status})`);
  return res.body.id;
}

async function createAttempt(user: TestUser, recipeId: string, body: object = {}): Promise<string> {
  const res = await request(app).post(`/recipes/${recipeId}/attempts`).set(authed(user)).send(body);
  if (res.status !== 201) throw new Error(`Attempt create failed (${res.status})`);
  return res.body.id;
}

function patchRecipe(user: TestUser, recipeId: string, body: object) {
  return request(app).patch(`/recipes/${recipeId}`).set(authed(user)).send(body);
}

function storedAttempt(id: string) {
  return prisma.attempt.findUniqueOrThrow({ where: { id } });
}

// What the recipe form sends on save: every field, changed or not.
function fullFormBody(overrides: object = {}) {
  return { ...baseRecipe, prepMinutes: null, cookMinutes: null, servings: null, story: null, imageUrl: null, ...overrides };
}

describe("PATCH /recipes/:id backfills null attempt snapshots", () => {
  it("editing only instructions backfills only instructions", async () => {
    const recipeId = await createRecipe(alice);
    const attemptId = await createAttempt(alice, recipeId);

    const res = await patchRecipe(alice, recipeId, { instructions: "Chop.\nSimmer longer." });

    expect(res.status).toBe(200);
    expect(res.body.instructions).toBe("Chop.\nSimmer longer.");
    expect((await storedAttempt(attemptId)).instructions).toBe(OLD_INSTRUCTIONS);
    expect(await ingredientsIsSqlNull(attemptId)).toBe(true);
  });

  it("editing only ingredients backfills only ingredients, as { text }[] lines", async () => {
    const recipeId = await createRecipe(alice);
    const attemptId = await createAttempt(alice, recipeId);

    const res = await patchRecipe(alice, recipeId, { ingredients: ["1 onion", "3 carrots", "salt"] });

    expect(res.status).toBe(200);
    const stored = await storedAttempt(attemptId);
    expect(stored.ingredients).toEqual([{ text: "1 onion" }, { text: "2 carrots" }]);
    expect(stored.instructions).toBeNull();
  });

  it("editing both backfills both", async () => {
    const recipeId = await createRecipe(alice);
    const attemptId = await createAttempt(alice, recipeId);

    await patchRecipe(alice, recipeId, { ingredients: ["1 leek"], instructions: "Boil." });

    expect(await storedAttempt(attemptId)).toMatchObject({
      ingredients: [{ text: "1 onion" }, { text: "2 carrots" }],
      instructions: OLD_INSTRUCTIONS,
    });
  });

  it("backfills every null attempt of the recipe", async () => {
    const recipeId = await createRecipe(alice);
    const ids = [await createAttempt(alice, recipeId), await createAttempt(alice, recipeId, { rating: 5 })];

    await patchRecipe(alice, recipeId, { instructions: "Boil." });

    for (const id of ids) {
      expect((await storedAttempt(id)).instructions).toBe(OLD_INSTRUCTIONS);
    }
  });

  it("backfills an empty old ingredient list as an empty snapshot", async () => {
    const recipeId = (
      await request(app).post("/recipes").set(authed(alice)).send({ ...baseRecipe, ingredients: [] })
    ).body.id as string;
    const attemptId = await createAttempt(alice, recipeId);

    await patchRecipe(alice, recipeId, { ingredients: ["1 onion"] });

    expect(await ingredientsIsSqlNull(attemptId)).toBe(false);
    expect((await storedAttempt(attemptId)).ingredients).toEqual([]);
  });

  it.each([
    ["only the title", { title: "Renamed Soup" }],
    ["only details", { prepMinutes: 10, servings: 4, story: "Grandma's." }],
    ["an empty body", {}],
    ["the full form with unchanged ingredients and instructions", fullFormBody({ title: "Renamed Soup" })],
    ["the same ingredients and instructions again", { ingredients: [...OLD_INGREDIENTS], instructions: OLD_INSTRUCTIONS }],
  ])("backfills nothing when sending %s", async (_label, body) => {
    const recipeId = await createRecipe(alice);
    const attemptId = await createAttempt(alice, recipeId);

    const res = await patchRecipe(alice, recipeId, body);

    expect(res.status).toBe(200);
    expect(await ingredientsIsSqlNull(attemptId)).toBe(true);
    expect((await storedAttempt(attemptId)).instructions).toBeNull();
  });

  it.each([
    ["reordered ingredients", { ingredients: ["2 carrots", "1 onion"] }, "ingredients"],
    ["one ingredient removed", { ingredients: ["1 onion"] }, "ingredients"],
    ["one ingredient added", { ingredients: [...OLD_INGREDIENTS, "salt"] }, "ingredients"],
    ["whitespace-only ingredient change", { ingredients: ["1 onion ", "2 carrots"] }, "ingredients"],
    ["instructions with a trailing newline", { instructions: `${OLD_INSTRUCTIONS}\n` }, "instructions"],
    ["empty instructions", { instructions: "" }, "instructions"],
  ])("counts %s as a change", async (_label, body, field) => {
    const recipeId = await createRecipe(alice);
    const attemptId = await createAttempt(alice, recipeId);

    const res = await patchRecipe(alice, recipeId, fullFormBody(body));

    expect(res.status).toBe(200);
    const stored = await storedAttempt(attemptId);
    if (field === "ingredients") {
      expect(stored.ingredients).toEqual([{ text: "1 onion" }, { text: "2 carrots" }]);
      expect(stored.instructions).toBeNull();
    } else {
      expect(stored.instructions).toBe(OLD_INSTRUCTIONS);
      expect(await ingredientsIsSqlNull(attemptId)).toBe(true);
    }
  });

  it("leaves attempts that already have a snapshot untouched", async () => {
    const recipeId = await createRecipe(alice);
    const ownIngredients = [{ text: "1 red onion", ingredientId: "ing_onion" }];
    const withIngredients = await createAttempt(alice, recipeId, { ingredients: ownIngredients });
    const withInstructions = await createAttempt(alice, recipeId, { instructions: "Roast." });
    const withEmpty = await createAttempt(alice, recipeId, { ingredients: [], instructions: "" });
    const plain = await createAttempt(alice, recipeId);

    await patchRecipe(alice, recipeId, { ingredients: ["1 leek"], instructions: "Boil." });

    expect(await storedAttempt(withIngredients)).toMatchObject({
      ingredients: ownIngredients,
      instructions: OLD_INSTRUCTIONS,
    });
    expect(await storedAttempt(withInstructions)).toMatchObject({
      ingredients: [{ text: "1 onion" }, { text: "2 carrots" }],
      instructions: "Roast.",
    });
    expect(await storedAttempt(withEmpty)).toMatchObject({ ingredients: [], instructions: "" });
    expect(await storedAttempt(plain)).toMatchObject({
      ingredients: [{ text: "1 onion" }, { text: "2 carrots" }],
      instructions: OLD_INSTRUCTIONS,
    });
  });

  it("leaves attempts of the user's other recipe untouched", async () => {
    const recipeId = await createRecipe(alice);
    const otherRecipeId = await createRecipe(alice);
    const otherAttemptId = await createAttempt(alice, otherRecipeId);

    await patchRecipe(alice, recipeId, { ingredients: ["1 leek"], instructions: "Boil." });

    expect(await ingredientsIsSqlNull(otherAttemptId)).toBe(true);
    expect((await storedAttempt(otherAttemptId)).instructions).toBeNull();
  });

  it("leaves another user's attempts untouched when they edit their own recipe", async () => {
    const aliceRecipeId = await createRecipe(alice);
    const bobRecipeId = await createRecipe(bob);
    const bobAttemptId = await createAttempt(bob, bobRecipeId);

    await patchRecipe(alice, aliceRecipeId, { ingredients: ["1 leek"], instructions: "Boil." });

    expect(await ingredientsIsSqlNull(bobAttemptId)).toBe(true);
    expect((await storedAttempt(bobAttemptId)).instructions).toBeNull();
  });

  it("backfills nothing when another user tries to edit the recipe (404)", async () => {
    const recipeId = await createRecipe(alice);
    const attemptId = await createAttempt(alice, recipeId);

    const res = await patchRecipe(bob, recipeId, { ingredients: ["1 leek"], instructions: "Boil." });

    expect(res.status).toBe(404);
    expect(await ingredientsIsSqlNull(attemptId)).toBe(true);
    expect((await storedAttempt(attemptId)).instructions).toBeNull();
  });

  it("backfills nothing when the edit is rejected with 400", async () => {
    const recipeId = await createRecipe(alice);
    const attemptId = await createAttempt(alice, recipeId);

    const res = await patchRecipe(alice, recipeId, {
      ingredients: ["1 leek"],
      instructions: "Boil.",
      imageUrl: "not a url",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("imageUrl must be an http(s) URL");
    expect(await ingredientsIsSqlNull(attemptId)).toBe(true);
    expect((await storedAttempt(attemptId)).instructions).toBeNull();
    const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } });
    expect(recipe).toMatchObject({ ingredients: OLD_INGREDIENTS, instructions: OLD_INSTRUCTIONS });
  });

  it("a second edit doesn't overwrite a snapshot the first edit filled in", async () => {
    const recipeId = await createRecipe(alice);
    const attemptId = await createAttempt(alice, recipeId);

    await patchRecipe(alice, recipeId, { ingredients: ["1 leek"], instructions: "Boil." });
    await patchRecipe(alice, recipeId, { ingredients: ["2 leeks"], instructions: "Boil longer." });

    expect(await storedAttempt(attemptId)).toMatchObject({
      ingredients: [{ text: "1 onion" }, { text: "2 carrots" }],
      instructions: OLD_INSTRUCTIONS,
    });
  });

  it("an attempt made between two edits gets the version it was cooked from", async () => {
    const recipeId = await createRecipe(alice);
    const first = await createAttempt(alice, recipeId);
    await patchRecipe(alice, recipeId, { instructions: "Boil." });
    const second = await createAttempt(alice, recipeId);

    await patchRecipe(alice, recipeId, { instructions: "Boil longer." });

    expect((await storedAttempt(first)).instructions).toBe(OLD_INSTRUCTIONS);
    expect((await storedAttempt(second)).instructions).toBe("Boil.");
  });

  it("never changes tweaked: false stays false after a backfill, true stays true", async () => {
    const recipeId = await createRecipe(alice);
    const plain = await createAttempt(alice, recipeId);
    const tweaked = await createAttempt(alice, recipeId, { instructions: "Roast." });

    await patchRecipe(alice, recipeId, { ingredients: ["1 leek"], instructions: "Boil." });

    expect(await storedAttempt(plain)).toMatchObject({ instructions: OLD_INSTRUCTIONS, tweaked: false });
    expect(await storedAttempt(tweaked)).toMatchObject({ instructions: "Roast.", tweaked: true });

    const list = await request(app).get(`/recipes/${recipeId}/attempts`).set(authed(alice));
    const byId = new Map(list.body.map((a: { id: string; tweaked: boolean }) => [a.id, a.tweaked]));
    expect(byId.get(plain)).toBe(false);
    expect(byId.get(tweaked)).toBe(true);
  });
});

// The migration's one-off UPDATE for rows that existed before `tweaked`.
// It is read from the migration file (so the test runs the real statement)
// and scoped to this test's own recipe with an extra WHERE, because the
// statement itself rewrites every row in the table and other test files
// share the database.
describe("migration add_attempt_tweaked backfill", () => {
  const migrationSql = readFileSync(
    new URL("../prisma/migrations/20260926132202_add_attempt_tweaked/migration.sql", import.meta.url),
    "utf8",
  );

  function scopedUpdate(): string {
    const statement = migrationSql
      .split(";")
      .map((part) => part.replace(/^\s*--.*$/gm, "").trim())
      .find((part) => /^UPDATE\s+"attempt"/i.test(part));
    if (!statement) throw new Error("No UPDATE \"attempt\" statement found in the migration");
    const joiner = /\bWHERE\b/i.test(statement) ? "AND" : "WHERE";
    return `${statement} ${joiner} "recipeId" = $1`;
  }

  it("sets tweaked from whether a snapshot exists, only on the scoped rows", async () => {
    const recipeId = await createRecipe(alice);
    const outsideRecipeId = await createRecipe(alice);
    // Rows as they were before the migration, with tweaked forced to the
    // wrong value so the UPDATE has to flip every one of them.
    const make = (recipe: string, data: Omit<Prisma.AttemptUncheckedCreateInput, "recipeId">) =>
      prisma.attempt.create({ data: { recipeId: recipe, ...data } });
    const none = await make(recipeId, { ingredients: Prisma.DbNull, instructions: null, tweaked: true });
    const ingredientsOnly = await make(recipeId, { ingredients: [{ text: "1 onion" }], tweaked: false });
    const instructionsOnly = await make(recipeId, { ingredients: Prisma.DbNull, instructions: "Roast.", tweaked: false });
    const emptySnapshots = await make(recipeId, { ingredients: [], instructions: "", tweaked: false });
    const outside = await make(outsideRecipeId, { ingredients: Prisma.DbNull, instructions: null, tweaked: true });

    const updated = await prisma.$executeRawUnsafe(scopedUpdate(), recipeId);

    expect(updated).toBe(4);
    const tweakedOf = async (id: string) => (await storedAttempt(id)).tweaked;
    expect(await tweakedOf(none.id)).toBe(false);
    expect(await tweakedOf(ingredientsOnly.id)).toBe(true);
    expect(await tweakedOf(instructionsOnly.id)).toBe(true);
    expect(await tweakedOf(emptySnapshots.id)).toBe(true);
    // Out of scope: untouched, still the wrong value we forced.
    expect(await tweakedOf(outside.id)).toBe(true);
  });
});
