import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { authed, createTestUser, deleteTestUsers, ingredientsIsSqlNull, TestUser } from "./helpers.js";

const validRecipe = {
  title: "Test Soup",
  ingredients: ["1 onion", "2 carrots"],
  instructions: "Chop and simmer.",
};

const MISSING_ID = "cl_does_not_exist_000000";

let alice: TestUser;
let bob: TestUser;

async function createRecipe(user: TestUser): Promise<string> {
  const res = await request(app).post("/recipes").set(authed(user)).send(validRecipe);
  if (res.status !== 201) throw new Error(`Recipe create failed (${res.status})`);
  return res.body.id;
}

async function createAttempt(user: TestUser, recipeId: string, body: object = {}) {
  return request(app).post(`/recipes/${recipeId}/attempts`).set(authed(user)).send(body);
}

let aliceRecipeId: string;
let aliceOtherRecipeId: string;
let bobRecipeId: string;

beforeAll(async () => {
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
  aliceRecipeId = await createRecipe(alice);
  aliceOtherRecipeId = await createRecipe(alice);
  bobRecipeId = await createRecipe(bob);
});

afterAll(async () => {
  await deleteTestUsers(alice, bob);
  await prisma.$disconnect();
});

describe("auth guard", () => {
  it("rejects GET /recipes/:recipeId/attempts without a session", async () => {
    const res = await request(app).get(`/recipes/${aliceRecipeId}/attempts`);
    expect(res.status).toBe(401);
  });

  it("rejects POST /recipes/:recipeId/attempts without a session", async () => {
    const res = await request(app).post(`/recipes/${aliceRecipeId}/attempts`).send({});
    expect(res.status).toBe(401);
  });

  it("rejects GET /attempts/:id without a session", async () => {
    const created = await createAttempt(alice, aliceRecipeId);
    const res = await request(app).get(`/attempts/${created.body.id}`);
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await request(app)
      .get(`/recipes/${aliceRecipeId}/attempts`)
      .set("Authorization", "Bearer not-a-token");
    expect(res.status).toBe(401);
  });
});

describe("POST /recipes/:recipeId/attempts", () => {
  it("creates an attempt from an empty body with every optional field null", async () => {
    const res = await createAttempt(alice, aliceRecipeId, {});

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      recipeId: aliceRecipeId,
      durationMinutes: null,
      rating: null,
      notes: null,
      ingredients: null,
      instructions: null,
      basedOnAttemptId: null,
      tweaked: false,
    });
    expect(typeof res.body.id).toBe("string");
    expect(Number.isNaN(Date.parse(res.body.madeAt))).toBe(false);
    expect(await ingredientsIsSqlNull(res.body.id)).toBe(true);
  });

  it("stores explicit null ingredients and instructions as null (SQL NULL for ingredients)", async () => {
    const res = await createAttempt(alice, aliceRecipeId, {
      ingredients: null,
      instructions: null,
      rating: null,
      durationMinutes: null,
      notes: null,
      basedOnAttemptId: null,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ingredients: null, instructions: null, basedOnAttemptId: null });
    expect(await ingredientsIsSqlNull(res.body.id)).toBe(true);
  });

  it("round-trips a full body and trims notes and ingredient text", async () => {
    const res = await createAttempt(alice, aliceRecipeId, {
      durationMinutes: 42,
      rating: 4,
      notes: "  Needed more salt.  ",
      ingredients: [{ text: "  1 onion " }, { text: "3 carrots", ingredientId: "ing_carrot" }],
      instructions: "Chop.\nSimmer longer.",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      durationMinutes: 42,
      rating: 4,
      notes: "Needed more salt.",
      ingredients: [{ text: "1 onion" }, { text: "3 carrots", ingredientId: "ing_carrot" }],
      instructions: "Chop.\nSimmer longer.",
    });
    expect(res.body.ingredients[0]).not.toHaveProperty("ingredientId");

    const stored = await prisma.attempt.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored).toMatchObject({
      durationMinutes: 42,
      rating: 4,
      notes: "Needed more salt.",
      ingredients: [{ text: "1 onion" }, { text: "3 carrots", ingredientId: "ing_carrot" }],
      instructions: "Chop.\nSimmer longer.",
    });
  });

  it("stores an empty ingredients array as an empty snapshot, not null", async () => {
    const res = await createAttempt(alice, aliceRecipeId, { ingredients: [] });
    expect(res.status).toBe(201);
    expect(res.body.ingredients).toEqual([]);
  });

  it.each([
    ["boundary rating 1", { rating: 1 }],
    ["boundary rating 5", { rating: 5 }],
    ["durationMinutes 0", { durationMinutes: 0 }],
    ["durationMinutes 10000", { durationMinutes: 10000 }],
  ])("accepts %s", async (_label, body) => {
    const res = await createAttempt(alice, aliceRecipeId, body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject(body);
  });

  it.each([
    ["empty notes", ""],
    ["whitespace-only notes", "  \n\t "],
  ])("stores %s as null", async (_label, notes) => {
    const res = await createAttempt(alice, aliceRecipeId, { notes });
    expect(res.status).toBe(201);
    expect(res.body.notes).toBeNull();

    const stored = await prisma.attempt.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.notes).toBeNull();
  });

  it.each([
    ["rating 0", { rating: 0 }, /^rating: /],
    ["rating 6", { rating: 6 }, /^rating: /],
    ["fractional rating", { rating: 2.5 }, /^rating: /],
    ["string rating", { rating: "3" }, /^rating: /],
    ["negative durationMinutes", { durationMinutes: -1 }, /^durationMinutes: /],
    ["fractional durationMinutes", { durationMinutes: 1.5 }, /^durationMinutes: /],
    ["durationMinutes over 10000", { durationMinutes: 10001 }, /^durationMinutes: /],
    ["non-array ingredients", { ingredients: "1 onion" }, /^ingredients: /],
    ["an ingredient line missing text", { ingredients: [{ ingredientId: "x" }] }, /^ingredients\.0\.text: /],
    [
      "an ingredient line with empty text",
      { ingredients: [{ text: "ok" }, { text: "" }] },
      /^ingredients\.1\.text: ingredient text must not be empty$/,
    ],
    [
      "an ingredient line with whitespace-only text",
      { ingredients: [{ text: "   " }] },
      /^ingredients\.0\.text: ingredient text must not be empty$/,
    ],
    [
      "an ingredient line with an unknown key",
      { ingredients: [{ text: "1 onion", amount: 2 }] },
      /^ingredients\.0: .*amount/,
    ],
    ["a plain-string ingredient line", { ingredients: ["1 onion"] }, /^ingredients\.0: /],
    ["an unknown top-level key", { madeAt: "2026-09-21T12:00:00.000Z" }, /madeAt/],
    ["non-string instructions", { instructions: ["Chop."] }, /^instructions: /],
    ["non-string notes", { notes: 5 }, /^notes: /],
    ["empty basedOnAttemptId", { basedOnAttemptId: "" }, /^basedOnAttemptId: /],
    // tweaked is derived from the snapshots, never sent by the client.
    ["tweaked true", { tweaked: true }, /tweaked/],
    ["tweaked false next to a snapshot", { tweaked: false, instructions: "Chop." }, /tweaked/],
  ])("rejects %s with 400", async (_label, body, message) => {
    const before = await prisma.attempt.count({ where: { recipeId: aliceRecipeId } });

    const res = await createAttempt(alice, aliceRecipeId, body);

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error).toMatch(message);
    expect(await prisma.attempt.count({ where: { recipeId: aliceRecipeId } })).toBe(before);
  });

  it.each([
    ["an ingredients snapshot", { ingredients: [{ text: "1 onion" }] }, true],
    ["an instructions snapshot", { instructions: "Chop.\nSimmer." }, true],
    ["both snapshots", { ingredients: [{ text: "1 onion" }], instructions: "Chop." }, true],
    // Boundaries: an empty snapshot is still a snapshot (everything removed).
    ["an empty ingredients snapshot", { ingredients: [] }, true],
    ["an empty instructions snapshot", { instructions: "" }, true],
    ["an ingredients snapshot next to null instructions", { ingredients: [{ text: "1 onion" }], instructions: null }, true],
    ["no snapshots (omitted)", { rating: 4 }, false],
    ["explicit null snapshots", { ingredients: null, instructions: null }, false],
  ])("sets tweaked from the snapshots: %s", async (_label, body, tweaked) => {
    const res = await createAttempt(alice, aliceRecipeId, body);

    expect(res.status).toBe(201);
    expect(res.body.tweaked).toBe(tweaked);
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id: res.body.id } })).tweaked).toBe(tweaked);
  });

  it("returns 404 for another user's recipe", async () => {
    const res = await createAttempt(alice, bobRecipeId, { rating: 3 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Recipe not found");
    expect(await prisma.attempt.count({ where: { recipeId: bobRecipeId } })).toBe(0);
  });

  it("returns 404 (not 400) for another user's recipe even with an invalid body", async () => {
    const res = await createAttempt(alice, bobRecipeId, { rating: 99 });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a nonexistent recipe", async () => {
    const res = await createAttempt(alice, MISSING_ID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Recipe not found");
  });
});

describe("POST basedOnAttemptId", () => {
  let baseAttemptId: string;
  let otherRecipeAttemptId: string;
  let bobAttemptId: string;

  beforeAll(async () => {
    baseAttemptId = (await createAttempt(alice, aliceRecipeId, { rating: 3 })).body.id;
    otherRecipeAttemptId = (await createAttempt(alice, aliceOtherRecipeId)).body.id;
    bobAttemptId = (await createAttempt(bob, bobRecipeId)).body.id;
  });

  it("accepts an attempt of the same recipe and stores the link", async () => {
    const res = await createAttempt(alice, aliceRecipeId, { basedOnAttemptId: baseAttemptId });

    expect(res.status).toBe(201);
    expect(res.body.basedOnAttemptId).toBe(baseAttemptId);

    const stored = await prisma.attempt.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.basedOnAttemptId).toBe(baseAttemptId);
  });

  it.each([
    ["an attempt of another recipe of the same user", () => otherRecipeAttemptId],
    ["a nonexistent attempt id", () => MISSING_ID],
    ["another user's attempt", () => bobAttemptId],
  ])("rejects %s with 400", async (_label, getId) => {
    const res = await createAttempt(alice, aliceRecipeId, { basedOnAttemptId: getId() });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("basedOnAttemptId must be an attempt of this recipe");
  });

  it("returns 404 for another user's recipe even when basedOnAttemptId is valid for it", async () => {
    const res = await createAttempt(alice, bobRecipeId, { basedOnAttemptId: bobAttemptId });
    expect(res.status).toBe(404);
  });
});

describe("GET /recipes/:recipeId/attempts", () => {
  let recipeId: string;
  let ids: { oldest: string; middle: string; newest: string };

  beforeAll(async () => {
    recipeId = await createRecipe(alice);
    // Created in an order that differs from madeAt, so the test proves the sort.
    const middle = (await createAttempt(alice, recipeId, { notes: "middle" })).body.id;
    const newest = (await createAttempt(alice, recipeId, { notes: "newest" })).body.id;
    const oldest = (await createAttempt(alice, recipeId, { notes: "oldest" })).body.id;
    await prisma.attempt.update({ where: { id: oldest }, data: { madeAt: new Date("2026-09-19T12:00:00.000Z") } });
    await prisma.attempt.update({ where: { id: middle }, data: { madeAt: new Date("2026-09-20T12:00:00.000Z") } });
    await prisma.attempt.update({ where: { id: newest }, data: { madeAt: new Date("2026-09-21T12:00:00.000Z") } });
    ids = { oldest, middle, newest };

    // Noise in another recipe that must not leak into the list.
    await createAttempt(alice, aliceOtherRecipeId, { notes: "other recipe" });
  });

  it("lists the recipe's attempts newest first by madeAt", async () => {
    const res = await request(app).get(`/recipes/${recipeId}/attempts`).set(authed(alice));

    expect(res.status).toBe(200);
    expect(res.body.map((a: { id: string }) => a.id)).toEqual([ids.newest, ids.middle, ids.oldest]);
    expect(res.body[0]).toMatchObject({
      recipeId,
      notes: "newest",
      madeAt: "2026-09-21T12:00:00.000Z",
    });
  });

  it("returns only that recipe's attempts", async () => {
    const res = await request(app).get(`/recipes/${recipeId}/attempts`).set(authed(alice));
    expect(res.body.every((a: { recipeId: string }) => a.recipeId === recipeId)).toBe(true);
  });

  it("returns an empty array for a recipe with no attempts", async () => {
    const emptyRecipeId = await createRecipe(alice);
    const res = await request(app).get(`/recipes/${emptyRecipeId}/attempts`).set(authed(alice));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 404 for another user's recipe", async () => {
    const res = await request(app).get(`/recipes/${recipeId}/attempts`).set(authed(bob));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Recipe not found");
  });

  it("returns 404 for a nonexistent recipe", async () => {
    const res = await request(app).get(`/recipes/${MISSING_ID}/attempts`).set(authed(alice));
    expect(res.status).toBe(404);
  });
});

describe("GET /attempts/:id", () => {
  let baseId: string;
  let derivedId: string;

  beforeAll(async () => {
    baseId = (await createAttempt(alice, aliceRecipeId, { rating: 2 })).body.id;
    await prisma.attempt.update({ where: { id: baseId }, data: { madeAt: new Date("2026-09-21T12:00:00.000Z") } });
    derivedId = (await createAttempt(alice, aliceRecipeId, { basedOnAttemptId: baseId, rating: 5 })).body.id;
  });

  it("returns the caller's attempt with basedOnAttempt null when not derived", async () => {
    const res = await request(app).get(`/attempts/${baseId}`).set(authed(alice));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: baseId, recipeId: aliceRecipeId, rating: 2, basedOnAttempt: null });
  });

  it("includes basedOnAttempt { id, madeAt } when derived", async () => {
    const res = await request(app).get(`/attempts/${derivedId}`).set(authed(alice));

    expect(res.status).toBe(200);
    expect(res.body.basedOnAttemptId).toBe(baseId);
    expect(res.body.basedOnAttempt).toEqual({ id: baseId, madeAt: "2026-09-21T12:00:00.000Z" });
  });

  it("returns 404 for another user's attempt", async () => {
    const res = await request(app).get(`/attempts/${baseId}`).set(authed(bob));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Attempt not found");
  });

  it("returns 404 for a nonexistent attempt", async () => {
    const res = await request(app).get(`/attempts/${MISSING_ID}`).set(authed(alice));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Attempt not found");
  });
});

describe("cascade and SetNull", () => {
  it("deleting a recipe removes its attempts", async () => {
    const recipeId = await createRecipe(alice);
    const a1 = (await createAttempt(alice, recipeId)).body.id;
    const a2 = (await createAttempt(alice, recipeId, { basedOnAttemptId: a1 })).body.id;

    const del = await request(app).delete(`/recipes/${recipeId}`).set(authed(alice));
    expect(del.status).toBe(204);

    expect(await prisma.attempt.count({ where: { id: { in: [a1, a2] } } })).toBe(0);
    const get = await request(app).get(`/attempts/${a1}`).set(authed(alice));
    expect(get.status).toBe(404);
  });

  it("deleting a base attempt sets derived attempts' basedOnAttemptId to null", async () => {
    const base = (await createAttempt(alice, aliceRecipeId)).body.id;
    const derived = (await createAttempt(alice, aliceRecipeId, { basedOnAttemptId: base })).body.id;

    await prisma.attempt.delete({ where: { id: base } });

    const res = await request(app).get(`/attempts/${derived}`).set(authed(alice));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ basedOnAttemptId: null, basedOnAttempt: null });
  });
});

describe("PATCH /attempts/:id", () => {
  async function patchAttempt(user: TestUser, id: string, body: object) {
    return request(app).patch(`/attempts/${id}`).set(authed(user)).send(body);
  }

  async function freshAttempt(body: object = { rating: 3, notes: "Good.", durationMinutes: 30 }) {
    return (await createAttempt(alice, aliceRecipeId, body)).body.id as string;
  }

  it("rejects without a session", async () => {
    const id = await freshAttempt();
    const res = await request(app).patch(`/attempts/${id}`).send({ rating: 4 });
    expect(res.status).toBe(401);
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id } })).rating).toBe(3);
  });

  it("sets a rating on an unrated attempt and persists it", async () => {
    const id = await freshAttempt({});
    const res = await patchAttempt(alice, id, { rating: 4 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, recipeId: aliceRecipeId, rating: 4, notes: null });
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id } })).rating).toBe(4);
  });

  it.each([1, 5])("accepts boundary rating %i", async (rating) => {
    const id = await freshAttempt({});
    const res = await patchAttempt(alice, id, { rating });
    expect(res.status).toBe(200);
    expect(res.body.rating).toBe(rating);
  });

  it("leaves notes untouched when only rating is sent", async () => {
    const id = await freshAttempt();
    const res = await patchAttempt(alice, id, { rating: 5 });

    expect(res.status).toBe(200);
    const stored = await prisma.attempt.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ rating: 5, notes: "Good.", durationMinutes: 30 });
  });

  it("leaves rating untouched when only notes are sent, and trims notes", async () => {
    const id = await freshAttempt();
    const res = await patchAttempt(alice, id, { notes: "  Even better the next day.  " });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rating: 3, notes: "Even better the next day." });
    const stored = await prisma.attempt.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ rating: 3, notes: "Even better the next day." });
  });

  it("changes nothing for an empty body", async () => {
    const id = await freshAttempt();
    const res = await patchAttempt(alice, id, {});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rating: 3, notes: "Good.", durationMinutes: 30 });
  });

  it("clears rating and notes with explicit null", async () => {
    const id = await freshAttempt();
    const res = await patchAttempt(alice, id, { rating: null, notes: null });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rating: null, notes: null });
    const stored = await prisma.attempt.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ rating: null, notes: null, durationMinutes: 30 });
  });

  it.each([
    ["empty notes", ""],
    ["whitespace-only notes", "  \n\t "],
  ])("stores %s as null", async (_label, notes) => {
    const id = await freshAttempt();
    const res = await patchAttempt(alice, id, { notes });

    expect(res.status).toBe(200);
    expect(res.body.notes).toBeNull();
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id } })).notes).toBeNull();
  });

  it("includes basedOnAttempt null for an attempt that isn't derived", async () => {
    const id = await freshAttempt();
    const res = await patchAttempt(alice, id, { rating: 2 });
    expect(res.status).toBe(200);
    expect(res.body.basedOnAttempt).toBeNull();
  });

  it("includes basedOnAttempt { id, madeAt } like GET for a derived attempt", async () => {
    const baseId = await freshAttempt();
    await prisma.attempt.update({ where: { id: baseId }, data: { madeAt: new Date("2026-09-21T12:00:00.000Z") } });
    const derivedId = (await createAttempt(alice, aliceRecipeId, { basedOnAttemptId: baseId })).body.id;

    const res = await patchAttempt(alice, derivedId, { rating: 4 });

    expect(res.status).toBe(200);
    expect(res.body.basedOnAttemptId).toBe(baseId);
    expect(res.body.basedOnAttempt).toEqual({ id: baseId, madeAt: "2026-09-21T12:00:00.000Z" });
  });

  it.each([
    ["rating 0", { rating: 0 }, /^rating: /],
    ["rating 6", { rating: 6 }, /^rating: /],
    ["fractional rating", { rating: 2.5 }, /^rating: /],
    ["string rating", { rating: "3" }, /^rating: /],
    ["non-string notes", { notes: 5 }, /^notes: /],
    ["an ingredients snapshot", { ingredients: [{ text: "1 onion" }] }, /ingredients/],
    ["an instructions snapshot", { instructions: "Chop." }, /instructions/],
    ["durationMinutes", { durationMinutes: 10 }, /durationMinutes/],
    ["basedOnAttemptId", { basedOnAttemptId: null }, /basedOnAttemptId/],
    ["madeAt", { madeAt: "2026-09-21T12:00:00.000Z" }, /madeAt/],
    ["a valid rating next to a snapshot field", { rating: 4, instructions: "Chop." }, /instructions/],
    ["tweaked", { tweaked: false }, /tweaked/],
  ])("rejects %s with 400 and changes nothing", async (_label, body, message) => {
    const id = await freshAttempt();
    const before = await prisma.attempt.findUniqueOrThrow({ where: { id } });

    const res = await patchAttempt(alice, id, body);

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error).toMatch(message);
    expect(await prisma.attempt.findUniqueOrThrow({ where: { id } })).toEqual(before);
  });

  it("returns 404 for another user's attempt and leaves it unchanged", async () => {
    const bobAttemptId = (await createAttempt(bob, bobRecipeId, { rating: 2 })).body.id;

    const res = await patchAttempt(alice, bobAttemptId, { rating: 5 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Attempt not found");
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id: bobAttemptId } })).rating).toBe(2);
  });

  it("returns 404 (not 400) for another user's attempt even with an invalid body", async () => {
    const bobAttemptId = (await createAttempt(bob, bobRecipeId)).body.id;
    const res = await patchAttempt(alice, bobAttemptId, { rating: 99 });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a nonexistent attempt", async () => {
    const res = await patchAttempt(alice, MISSING_ID, { rating: 3 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Attempt not found");
  });
});

describe("GET /attempts?unrated=true", () => {
  const HOUR = 60 * 60 * 1000;
  // Own users: the rest of this file leaves fresh unrated attempts for
  // alice and bob.
  let carol: TestUser;
  let dave: TestUser;
  let carolRecipeId: string;
  let daveRecipeId: string;

  async function getUnrated(user: TestUser) {
    return request(app).get("/attempts?unrated=true").set(authed(user));
  }

  async function attemptAt(user: TestUser, recipeId: string, hoursAgo: number, body: object = {}) {
    const id = (await createAttempt(user, recipeId, body)).body.id as string;
    await prisma.attempt.update({ where: { id }, data: { madeAt: new Date(Date.now() - hoursAgo * HOUR) } });
    return id;
  }

  beforeAll(async () => {
    carol = await createTestUser("Carol");
    dave = await createTestUser("Dave");
    carolRecipeId = await createRecipe(carol);
    daveRecipeId = await createRecipe(dave);
  });

  afterAll(async () => {
    await deleteTestUsers(carol, dave);
  });

  it("rejects without a session", async () => {
    const res = await request(app).get("/attempts?unrated=true");
    expect(res.status).toBe(401);
  });

  it.each([
    ["no query", "/attempts"],
    ["unrated=false", "/attempts?unrated=false"],
    ["unrated=1", "/attempts?unrated=1"],
    ["an empty unrated", "/attempts?unrated="],
  ])("rejects %s with 400", async (_label, url) => {
    const res = await request(app).get(url).set(authed(carol));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unrated=true is required");
  });

  it("returns JSON null when the viewer has no attempts", async () => {
    const res = await getUnrated(carol);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toBeNull();
  });

  describe("with a mix of attempts", () => {
    let newestUnratedId: string;
    let olderUnratedId: string;

    beforeAll(async () => {
      // Rated and newest overall: must be skipped.
      await attemptAt(carol, carolRecipeId, 0.5, { rating: 4 });
      newestUnratedId = await attemptAt(carol, carolRecipeId, 2, { durationMinutes: 42 });
      olderUnratedId = await attemptAt(carol, carolRecipeId, 30);
      // Outside the 48 h window.
      await attemptAt(carol, carolRecipeId, 49);
      // Another user's attempt, newer than all of carol's unrated ones.
      await attemptAt(dave, daveRecipeId, 0.1);
    });

    it("returns the viewer's newest unrated attempt with recipe { id, title }", async () => {
      const res = await getUnrated(carol);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: newestUnratedId,
        recipeId: carolRecipeId,
        rating: null,
        durationMinutes: 42,
        recipe: { id: carolRecipeId, title: validRecipe.title },
      });
      expect(Object.keys(res.body.recipe).sort()).toEqual(["id", "title"]);
    });

    it("falls back to the next unrated attempt once the newest is rated", async () => {
      await prisma.attempt.update({ where: { id: newestUnratedId }, data: { rating: 5 } });

      const res = await getUnrated(carol);

      expect(res.body.id).toBe(olderUnratedId);
    });

    it("returns null when the only unrated attempts are older than 48 h", async () => {
      await prisma.attempt.update({ where: { id: olderUnratedId }, data: { rating: 3 } });

      const res = await getUnrated(carol);

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });

    it("includes an attempt just inside the 48 h window", async () => {
      const id = await attemptAt(carol, carolRecipeId, 47.9);
      const res = await getUnrated(carol);
      expect(res.body.id).toBe(id);
    });

    it("returns only the viewer's own attempt", async () => {
      const res = await getUnrated(dave);
      expect(res.body.recipeId).toBe(daveRecipeId);
      expect(res.body.recipe.id).toBe(daveRecipeId);
    });
  });
});

describe("tweaked in responses", () => {
  // Own user, so the unrated query only sees this block's attempts.
  let erin: TestUser;
  let recipeId: string;
  let plainId: string;
  let tweakedId: string;

  beforeAll(async () => {
    erin = await createTestUser("Erin");
    recipeId = await createRecipe(erin);
    plainId = (await createAttempt(erin, recipeId, { rating: 4 })).body.id;
    tweakedId = (await createAttempt(erin, recipeId, { instructions: "Chop.\nSimmer longer." })).body.id;
  });

  afterAll(async () => {
    await deleteTestUsers(erin);
  });

  it("GET /recipes/:recipeId/attempts includes tweaked on every attempt", async () => {
    const res = await request(app).get(`/recipes/${recipeId}/attempts`).set(authed(erin));

    expect(res.status).toBe(200);
    const byId = new Map(res.body.map((a: { id: string; tweaked: unknown }) => [a.id, a.tweaked]));
    expect(byId.get(plainId)).toBe(false);
    expect(byId.get(tweakedId)).toBe(true);
  });

  it.each([
    ["an untweaked", () => plainId, false],
    ["a tweaked", () => tweakedId, true],
  ])("GET /attempts/:id includes tweaked for %s attempt", async (_label, getId, tweaked) => {
    const res = await request(app).get(`/attempts/${getId()}`).set(authed(erin));
    expect(res.status).toBe(200);
    expect(res.body.tweaked).toBe(tweaked);
  });

  it("GET /attempts?unrated=true includes tweaked", async () => {
    const res = await request(app).get("/attempts?unrated=true").set(authed(erin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: tweakedId, tweaked: true });
  });

  it("PATCH /attempts/:id returns tweaked and leaves it as is", async () => {
    const res = await request(app).patch(`/attempts/${tweakedId}`).set(authed(erin)).send({ rating: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rating: 3, tweaked: true });
  });
});

describe("attempt fullness", () => {
  it.each(["STILL_HUNGRY", "SATISFIED", "VERY_FULL", null])("POST stores fullness %j", async (fullness) => {
    const res = await createAttempt(alice, aliceRecipeId, { rating: 4, fullness });
    expect(res.status).toBe(201);
    expect(res.body.fullness).toBe(fullness);
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id: res.body.id } })).fullness).toBe(fullness);
  });

  it("POST leaves fullness null when omitted, and GET returns it", async () => {
    const res = await createAttempt(alice, aliceRecipeId, { rating: 4 });
    expect(res.body.fullness).toBeNull();
    const got = await request(app).get(`/attempts/${res.body.id}`).set(authed(alice));
    expect(got.body.fullness).toBeNull();
  });

  it.each(["HUNGRY", "satisfied", 2])("POST rejects fullness %j with 400", async (fullness) => {
    const res = await createAttempt(alice, aliceRecipeId, { fullness });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^fullness: /);
  });

  it("PATCH sets, keeps (when omitted) and clears fullness", async () => {
    const id = (await createAttempt(alice, aliceRecipeId, {})).body.id as string;
    const patch = (body: object) => request(app).patch(`/attempts/${id}`).set(authed(alice)).send(body);

    expect((await patch({ fullness: "VERY_FULL" })).body.fullness).toBe("VERY_FULL");
    const rated = await patch({ rating: 5 });
    expect(rated.body).toMatchObject({ rating: 5, fullness: "VERY_FULL" });
    const cleared = await patch({ fullness: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ rating: 5, fullness: null });
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id } })).fullness).toBeNull();
  });

  it("PATCH rejects an unknown fullness with 400 and changes nothing", async () => {
    const id = (await createAttempt(alice, aliceRecipeId, { fullness: "SATISFIED" })).body.id as string;
    const res = await request(app).patch(`/attempts/${id}`).set(authed(alice)).send({ fullness: "STUFFED" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^fullness: /);
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id } })).fullness).toBe("SATISFIED");
  });

  it("PATCH returns 404 for another user's attempt and leaves its fullness", async () => {
    const id = (await createAttempt(bob, bobRecipeId, { fullness: "SATISFIED" })).body.id as string;
    const res = await request(app).patch(`/attempts/${id}`).set(authed(alice)).send({ fullness: "VERY_FULL" });
    expect(res.status).toBe(404);
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id } })).fullness).toBe("SATISFIED");
  });
});
