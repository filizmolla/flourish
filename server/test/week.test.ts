import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import type { Nutrient } from "../src/generated/prisma/client.js";
import { authed, createAttempt, createRecipe, createTestUser, deleteTestUsers, TestUser } from "./helpers.js";

// Phase 6 "Your week": GET /week?from=&to= returns the viewer's meals and
// cooked attempts in [from, to), oldest first, each attempt with the
// nutrients its recipe's current linked lines bring.

// Made-up foods, so no other file's catalog rows (or the seeded catalog)
// match these lines, and these rows match no other file's lines.
const VEXLORN = "vexlorn"; // PROTEIN
const DRIMBLEAF = "drimbleaf"; // FIBER
const SHOLVANUT = "sholvanut"; // HEALTHY_FAT + FIBER
const ingredientIds: string[] = [];

async function createCatalogRow(normalizedName: string, nutrients: Nutrient[]): Promise<void> {
  // A row left over from an interrupted run would break the unique name.
  await prisma.ingredient.deleteMany({ where: { normalizedName } });
  const ingredient = await prisma.ingredient.create({
    data: { name: normalizedName, normalizedName, aliases: [], mainGroup: nutrients[0] ?? "CARB", nutrients },
  });
  ingredientIds.push(ingredient.id);
}

// A week well away from "now", so attempts created at "now" never land in it.
const FROM = "2026-08-03T00:00:00.000Z";
const TO = "2026-08-10T00:00:00.000Z";
const MID = "2026-08-05T12:00:00.000Z";
const LATER = "2026-08-07T12:00:00.000Z";
const JUST_BEFORE = "2026-08-02T23:59:59.999Z";
const LAST_MS = "2026-08-09T23:59:59.999Z";

const MEAL_KEYS = ["createdAt", "eatenAt", "fullness", "hasPhoto", "id", "kind", "nutrients", "text", "updatedAt"];
const ATTEMPT_KEYS = ["fullness", "hasPhoto", "id", "madeAt", "nutrients", "rating", "recipe", "recipeId"];

let alice: TestUser;
let bob: TestUser;

function getWeek(user: TestUser, query: Record<string, string | string[]>) {
  return request(app).get("/week").query(query).set(authed(user));
}

async function createMeal(user: TestUser, body: object): Promise<string> {
  const res = await request(app).post("/meals").set(authed(user)).send(body);
  if (res.status !== 201) throw new Error(`Meal create failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.id;
}

// Attempts are stamped with madeAt = now; move them into the test week.
async function createAttemptAt(user: TestUser, recipeId: string, madeAt: string, body: object = {}): Promise<string> {
  const id = await createAttempt(user, recipeId, body);
  await prisma.attempt.update({ where: { id }, data: { madeAt: new Date(madeAt) } });
  return id;
}

beforeAll(async () => {
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
  await createCatalogRow(VEXLORN, ["PROTEIN"]);
  await createCatalogRow(DRIMBLEAF, ["FIBER"]);
  await createCatalogRow(SHOLVANUT, ["HEALTHY_FAT", "FIBER"]);
});

afterAll(async () => {
  await deleteTestUsers(alice, bob);
  await prisma.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
  await prisma.$disconnect();
});

describe("auth guard", () => {
  it("rejects a request without a session", async () => {
    const res = await request(app).get("/week").query({ from: FROM, to: TO });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await request(app)
      .get("/week")
      .query({ from: FROM, to: TO })
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });
});

describe("validation", () => {
  it.each([
    ["no parameters", {}, "from: Invalid input: expected string, received undefined"],
    ["a missing from", { to: TO }, "from: Invalid input: expected string, received undefined"],
    ["a missing to", { from: FROM }, "to: Invalid input: expected string, received undefined"],
    ["from equal to to", { from: FROM, to: FROM }, "from must be before to"],
    ["from after to", { from: TO, to: FROM }, "from must be before to"],
    [
      "a range one millisecond over 8 days",
      { from: FROM, to: "2026-08-11T00:00:00.001Z" },
      "The range can be at most 8 days",
    ],
    ["an unknown parameter", { from: FROM, to: TO, kind: "SNACK" }, 'Unrecognized key: "kind"'],
    ["a repeated from", { from: [FROM, MID], to: TO }, "from: Invalid input: expected string, received array"],
  ])("rejects %s with 400", async (_label, query, message) => {
    const res = await getWeek(alice, query);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });

  // Regression: zod 4 runs object-level refines even after a field fails its
  // ISO check, so these used to reach `to.getTime()` on a string and answer
  // 500 (fixed 2026-09-30 with `when` on the refines).
  it.each([
    ["a non-date from", { from: "monday", to: TO }, "from: Invalid ISO datetime"],
    ["a to without an offset", { from: FROM, to: "2026-08-10T00:00:00" }, "to: Invalid ISO datetime"],
    ["a date-only from", { from: "2026-08-03", to: TO }, "from: Invalid ISO datetime"],
  ])("rejects %s with 400", async (_label, query, message) => {
    const res = await getWeek(alice, query);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });

  it("accepts a range of exactly 8 days", async () => {
    const res = await getWeek(alice, { from: FROM, to: "2026-08-11T00:00:00.000Z" });
    expect(res.status).toBe(200);
  });

  it("accepts bounds with an offset", async () => {
    const res = await getWeek(alice, { from: "2026-08-03T00:00:00+03:00", to: "2026-08-10T00:00:00+03:00" });
    expect(res.status).toBe(200);
  });
});

describe("GET /week", () => {
  let carol: TestUser;
  const meals: Record<string, string> = {};
  const attempts: Record<string, string> = {};
  let recipeId: string;

  // Own user, so rows other tests add can't leak into these lists.
  beforeAll(async () => {
    carol = await createTestUser("Carol");
    recipeId = await createRecipe(carol, {
      title: "Carol's bowl",
      imageUrl: "https://example.com/bowl.jpg",
      source: "Mom",
      story: "A long story.",
      ingredients: [`1 ${SHOLVANUT}`, `2 ${VEXLORN}`],
    });

    // Created out of order, so the order must come from eatenAt / madeAt.
    meals.later = await createMeal(carol, { text: "dinner", eatenAt: LATER });
    meals.atFrom = await createMeal(carol, { text: "breakfast", eatenAt: FROM, kind: "SNACK" });
    meals.lastMs = await createMeal(carol, { text: "midnight snack", eatenAt: LAST_MS });
    meals.mid = await createMeal(carol, { text: "lunch", eatenAt: MID });
    meals.before = await createMeal(carol, { text: "too early", eatenAt: JUST_BEFORE });
    meals.atTo = await createMeal(carol, { text: "too late", eatenAt: TO });

    attempts.later = await createAttemptAt(carol, recipeId, LATER, { rating: 4, fullness: "SATISFIED" });
    attempts.atFrom = await createAttemptAt(carol, recipeId, FROM);
    attempts.lastMs = await createAttemptAt(carol, recipeId, LAST_MS);
    attempts.mid = await createAttemptAt(carol, recipeId, MID);
    attempts.before = await createAttemptAt(carol, recipeId, JUST_BEFORE);
    attempts.atTo = await createAttemptAt(carol, recipeId, TO);

    // Bob's rows in the same week, on his own recipe.
    await createMeal(bob, { text: "bob's lunch", eatenAt: MID });
    const bobRecipe = await createRecipe(bob, { ingredients: [`1 ${VEXLORN}`] });
    await createAttemptAt(bob, bobRecipe, MID);
  });

  afterAll(async () => {
    await deleteTestUsers(carol);
  });

  it("returns only the viewer's meals in [from, to), oldest first, in the /meals shape", async () => {
    const res = await getWeek(carol, { from: FROM, to: TO });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["attempts", "meals"]);
    expect(res.body.meals.map((meal: { id: string }) => meal.id)).toEqual([
      meals.atFrom,
      meals.mid,
      meals.later,
      meals.lastMs,
    ]);
    for (const meal of res.body.meals) expect(Object.keys(meal).sort()).toEqual(MEAL_KEYS);
    expect(res.body.meals[0]).toMatchObject({ kind: "SNACK", text: "breakfast", eatenAt: FROM, hasPhoto: false });
  });

  it("matches what GET /meals/:id returns for each meal", async () => {
    const res = await getWeek(carol, { from: FROM, to: TO });
    const single = await request(app).get(`/meals/${meals.mid}`).set(authed(carol));
    expect(res.body.meals.find((meal: { id: string }) => meal.id === meals.mid)).toEqual(single.body);
  });

  it("returns only the viewer's attempts in [from, to), oldest first", async () => {
    const res = await getWeek(carol, { from: FROM, to: TO });
    expect(res.status).toBe(200);
    expect(res.body.attempts.map((attempt: { id: string }) => attempt.id)).toEqual([
      attempts.atFrom,
      attempts.mid,
      attempts.later,
      attempts.lastMs,
    ]);
  });

  it("returns each attempt in the exact shape, with no other recipe fields", async () => {
    const res = await getWeek(carol, { from: FROM, to: TO });
    for (const attempt of res.body.attempts) {
      expect(Object.keys(attempt).sort()).toEqual(ATTEMPT_KEYS);
      expect(Object.keys(attempt.recipe).sort()).toEqual(["id", "imageUrl", "title"]);
    }
    expect(res.body.attempts[2]).toEqual({
      id: attempts.later,
      recipeId,
      madeAt: LATER,
      rating: 4,
      fullness: "SATISFIED",
      hasPhoto: false,
      recipe: { id: recipeId, title: "Carol's bowl", imageUrl: "https://example.com/bowl.jpg" },
      nutrients: ["PROTEIN", "FIBER", "HEALTHY_FAT"],
    });
    expect(res.body.attempts[0]).toMatchObject({ rating: null, fullness: null, hasPhoto: false });
  });

  it("returns hasPhoto true for an attempt with a photo, and never its photoPath", async () => {
    // Only the column matters here; GET /week never reads the file.
    await prisma.attempt.update({ where: { id: attempts.mid }, data: { photoPath: "attempts/x/y.jpg" } });
    try {
      const res = await getWeek(carol, { from: FROM, to: TO });
      const mid = res.body.attempts.find((attempt: { id: string }) => attempt.id === attempts.mid);
      expect(mid.hasPhoto).toBe(true);
      expect(Object.keys(mid).sort()).toEqual(ATTEMPT_KEYS);
      expect(JSON.stringify(res.body)).not.toContain("photoPath");
    } finally {
      await prisma.attempt.update({ where: { id: attempts.mid }, data: { photoPath: null } });
    }
  });

  it("includes rows exactly at from and excludes rows exactly at to (offset bounds read in UTC)", async () => {
    // 03:00+03:00 on Aug 3 is FROM; 03:00+03:00 on Aug 5 is 00:00Z, before MID.
    const res = await getWeek(carol, { from: "2026-08-03T03:00:00+03:00", to: "2026-08-05T15:00:00+03:00" });
    expect(res.status).toBe(200);
    expect(res.body.meals.map((meal: { id: string }) => meal.id)).toEqual([meals.atFrom]);
    expect(res.body.attempts.map((attempt: { id: string }) => attempt.id)).toEqual([attempts.atFrom]);
  });

  it("picks up rows just before from and exactly at to when the range moves", async () => {
    const res = await getWeek(carol, { from: JUST_BEFORE, to: "2026-08-10T00:00:00.001Z" });
    expect(res.body.meals.map((meal: { id: string }) => meal.id)).toEqual([
      meals.before,
      meals.atFrom,
      meals.mid,
      meals.later,
      meals.lastMs,
      meals.atTo,
    ]);
    expect(res.body.attempts.map((attempt: { id: string }) => attempt.id)).toEqual([
      attempts.before,
      attempts.atFrom,
      attempts.mid,
      attempts.later,
      attempts.lastMs,
      attempts.atTo,
    ]);
  });

  it("returns { meals: [], attempts: [] } for an empty week", async () => {
    const res = await getWeek(carol, { from: "2026-07-06T00:00:00.000Z", to: "2026-07-13T00:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meals: [], attempts: [] });
  });

  it("returns an empty week to a user with nothing logged", async () => {
    const dave = await createTestUser("Dave");
    try {
      const res = await getWeek(dave, { from: FROM, to: TO });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ meals: [], attempts: [] });
    } finally {
      await deleteTestUsers(dave);
    }
  });

  it("shows Bob only his own rows", async () => {
    const res = await getWeek(bob, { from: FROM, to: TO });
    expect(res.status).toBe(200);
    expect(res.body.meals.map((meal: { text: string }) => meal.text)).toEqual(["bob's lunch"]);
    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.attempts[0].recipeId).not.toBe(recipeId);
    expect(res.body.attempts[0].nutrients).toEqual(["PROTEIN"]);
  });
});

describe("attempt nutrients", () => {
  let erin: TestUser;

  beforeAll(async () => {
    erin = await createTestUser("Erin");
  });

  afterAll(async () => {
    await deleteTestUsers(erin);
  });

  async function nutrientsOf(attemptId: string) {
    const res = await getWeek(erin, { from: FROM, to: TO });
    expect(res.status).toBe(200);
    return res.body.attempts.find((attempt: { id: string }) => attempt.id === attemptId)?.nutrients;
  }

  it("is the union of the linked lines' nutrients, each once, in enum order", async () => {
    const recipe = await createRecipe(erin, {
      ingredients: [`1 ${SHOLVANUT}`, `1 ${DRIMBLEAF}`, `2 ${VEXLORN}`, `1 more ${DRIMBLEAF}`],
    });
    const attempt = await createAttemptAt(erin, recipe, MID);
    expect(await nutrientsOf(attempt)).toEqual(["PROTEIN", "FIBER", "HEALTHY_FAT"]);
  });

  it("ignores unlinked lines and section headings", async () => {
    const recipe = await createRecipe(erin, {
      ingredients: [`# ${VEXLORN} topping`, `1 ${DRIMBLEAF}`, "1 cup blorptang"],
    });
    const attempt = await createAttemptAt(erin, recipe, MID);
    expect(await nutrientsOf(attempt)).toEqual(["FIBER"]);
  });

  it("is [] for a recipe with no linked lines", async () => {
    const recipe = await createRecipe(erin, { ingredients: ["1 cup blorptang", "salt"] });
    const attempt = await createAttemptAt(erin, recipe, MID);
    expect(await nutrientsOf(attempt)).toEqual([]);
  });

  it("follows the recipe's current lines, not the attempt's snapshot", async () => {
    const recipe = await createRecipe(erin, { ingredients: [`1 ${VEXLORN}`] });
    const attempt = await createAttemptAt(erin, recipe, MID);
    expect(await nutrientsOf(attempt)).toEqual(["PROTEIN"]);

    const res = await request(app)
      .patch(`/recipes/${recipe}`)
      .set(authed(erin))
      .send({ ingredients: [`1 ${DRIMBLEAF}`] });
    expect(res.status).toBe(200);
    // The edit snapshots the old lines into the attempt; the week still reads today's.
    expect(await prisma.attempt.findUniqueOrThrow({ where: { id: attempt } })).toMatchObject({
      ingredients: [expect.objectContaining({ text: `1 ${VEXLORN}` })],
    });
    expect(await nutrientsOf(attempt)).toEqual(["FIBER"]);
  });

  it("drops a nutrient when the owner unlinks its line", async () => {
    const recipe = await createRecipe(erin, { ingredients: [`1 ${VEXLORN}`, `1 ${DRIMBLEAF}`] });
    const attempt = await createAttemptAt(erin, recipe, MID);
    const res = await request(app)
      .patch(`/recipes/${recipe}/lines/0`)
      .set(authed(erin))
      .send({ ingredientId: null });
    expect(res.status).toBe(200);
    expect(await nutrientsOf(attempt)).toEqual(["FIBER"]);
  });
});
