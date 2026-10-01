import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { authed, createAttempt, createRecipe, createTestUser, deleteTestUsers, TestUser } from "./helpers.js";

// "Save as new recipe": POST /recipes with forkedFromAttemptId.

const forkBody = {
  title: "Spicy Shakshuka",
  ingredients: ["4 eggs", "1 can tomatoes", "2 chillies"],
  instructions: "Simmer the sauce.\nCrack in the eggs.",
};

const MADE_AT = "2026-09-21T12:00:00.000Z";
const MISSING_ID = "cl_does_not_exist_000000";
const ALREADY_FORKED = "This attempt was already saved as a recipe";
const SAME_AS_RECIPE = "This attempt is the same as the recipe, so there is nothing to save";

// The original's lines; its attempts are compared against these.
const ORIGINAL = {
  ingredients: ["4 eggs", "1 can tomatoes"],
  instructions: "Simmer the sauce.\nCrack in the eggs.",
};
// An attempt that added a line while cooking, so it is a version worth forking.
const CHANGED_ATTEMPT = {
  ingredients: [{ text: "4 eggs" }, { text: "1 can tomatoes" }, { text: "2 chillies" }],
};

let alice: TestUser;
let bob: TestUser;

function postFork(user: TestUser, body: object) {
  return request(app).post("/recipes").set(authed(user)).send({ ...forkBody, ...body });
}

// A fresh original with one changed attempt cooked on MADE_AT.
async function originalWithAttempt(user: TestUser, title = "Shakshuka", attemptBody: object = CHANGED_ATTEMPT) {
  const recipeId = await createRecipe(user, { title, ...ORIGINAL });
  const attemptId = await createAttempt(user, recipeId, attemptBody);
  await prisma.attempt.update({ where: { id: attemptId }, data: { madeAt: new Date(MADE_AT) } });
  return { recipeId, attemptId };
}

beforeAll(async () => {
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
});

afterAll(async () => {
  await deleteTestUsers(alice, bob);
  await prisma.$disconnect();
});

describe("POST /recipes with forkedFromAttemptId", () => {
  it("rejects a fork request without a session", async () => {
    const { attemptId } = await originalWithAttempt(alice);
    const res = await request(app).post("/recipes").send({ ...forkBody, forkedFromAttemptId: attemptId });
    expect(res.status).toBe(401);
  });

  it("creates a linked recipe and returns forkedFrom { id, title, attemptId, madeAt }", async () => {
    const { recipeId, attemptId } = await originalWithAttempt(alice);

    const res = await postFork(alice, { forkedFromAttemptId: attemptId });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "Spicy Shakshuka",
      ingredients: forkBody.ingredients,
      forkedFromRecipeId: recipeId,
      forkedFromAttemptId: attemptId,
      forkedFrom: { id: recipeId, title: "Shakshuka", attemptId, madeAt: MADE_AT },
      forks: [],
    });
    // The raw relation objects are folded into forkedFrom.
    expect(res.body).not.toHaveProperty("forkedFromRecipe");
    expect(res.body).not.toHaveProperty("forkedFromAttempt");
  });

  it("saves the source the app sends (the original's, prefilled by the form)", async () => {
    const { attemptId } = await originalWithAttempt(alice);

    const res = await postFork(alice, { forkedFromAttemptId: attemptId, source: " @shakshukaqueen " });

    expect(res.status).toBe(201);
    expect(res.body.source).toBe("@shakshukaqueen");
  });

  it("returns 404 for another user's attempt and creates nothing", async () => {
    const { attemptId } = await originalWithAttempt(bob);

    const res = await postFork(alice, { title: "Stolen Shakshuka", forkedFromAttemptId: attemptId });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Attempt not found");
    expect(await prisma.recipe.count({ where: { title: "Stolen Shakshuka" } })).toBe(0);
  });

  it("returns 404 for a nonexistent attempt", async () => {
    const res = await postFork(alice, { forkedFromAttemptId: MISSING_ID });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Attempt not found");
  });

  it("returns 409 for a second fork of the same attempt and keeps the first", async () => {
    const { attemptId } = await originalWithAttempt(alice);
    const first = await postFork(alice, { forkedFromAttemptId: attemptId });
    expect(first.status).toBe(201);

    const second = await postFork(alice, { title: "Another Shakshuka", forkedFromAttemptId: attemptId });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe(ALREADY_FORKED);
    const forks = await prisma.recipe.findMany({ where: { forkedFromAttemptId: attemptId } });
    expect(forks.map((r) => r.id)).toEqual([first.body.id]);
  });

  it("lets two different attempts of the same recipe each be forked", async () => {
    const { recipeId, attemptId } = await originalWithAttempt(alice);
    const otherAttemptId = await createAttempt(alice, recipeId, CHANGED_ATTEMPT);

    expect((await postFork(alice, { forkedFromAttemptId: attemptId })).status).toBe(201);
    expect((await postFork(alice, { forkedFromAttemptId: otherAttemptId })).status).toBe(201);
  });

  it("returns 409 when a concurrent save wins the unique constraint (P2002)", async () => {
    const { attemptId } = await originalWithAttempt(alice);
    const first = await postFork(alice, { forkedFromAttemptId: attemptId });
    expect(first.status).toBe(201);

    // Simulate the race: the pre-check still sees no fork, so only the unique
    // index on forkedFromAttemptId can stop the second insert.
    const realFindFirst = prisma.attempt.findFirst.bind(prisma.attempt);
    const spy = vi.spyOn(prisma.attempt, "findFirst").mockImplementationOnce((async (args: unknown) => {
      const attempt = await realFindFirst(args as Parameters<typeof realFindFirst>[0]);
      return attempt && { ...attempt, fork: null };
    }) as unknown as typeof prisma.attempt.findFirst);
    try {
      const second = await postFork(alice, { title: "Racing Shakshuka", forkedFromAttemptId: attemptId });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(second.status).toBe(409);
      expect(second.body.error).toBe(ALREADY_FORKED);
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.recipe.count({ where: { title: "Racing Shakshuka" } })).toBe(0);
  });

  it("ends with exactly one fork when two saves of the same attempt run at once", async () => {
    const { attemptId } = await originalWithAttempt(alice);

    const results = await Promise.all([
      postFork(alice, { forkedFromAttemptId: attemptId }),
      postFork(alice, { forkedFromAttemptId: attemptId }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.recipe.count({ where: { forkedFromAttemptId: attemptId } })).toBe(1);
  });

  it("ignores a client-sent forkedFromRecipeId and takes the original from the attempt", async () => {
    const { recipeId, attemptId } = await originalWithAttempt(alice);
    const decoyId = await createRecipe(alice, { title: "Decoy" });
    const bobsRecipeId = await createRecipe(bob, { title: "Bob's" });

    const withFork = await postFork(alice, { forkedFromAttemptId: attemptId, forkedFromRecipeId: decoyId });
    expect(withFork.status).toBe(201);
    expect(withFork.body.forkedFromRecipeId).toBe(recipeId);
    expect(withFork.body.forkedFrom.id).toBe(recipeId);

    // Without an attempt it isn't a fork at all, even pointing at another user's recipe.
    const withoutAttempt = await postFork(alice, { forkedFromRecipeId: bobsRecipeId });
    expect(withoutAttempt.status).toBe(201);
    expect(withoutAttempt.body).toMatchObject({
      forkedFromRecipeId: null,
      forkedFromAttemptId: null,
      forkedFrom: null,
    });
  });

  it("treats forkedFromAttemptId null as a plain recipe", async () => {
    const res = await postFork(alice, { forkedFromAttemptId: null });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ forkedFromAttemptId: null, forkedFrom: null, forks: [] });
  });

  it.each([
    ["a number", 42],
    ["an empty string", ""],
    ["an object", { id: "a1" }],
    ["an array", ["a1"]],
    ["a boolean", true],
  ])("rejects forkedFromAttemptId as %s", async (_label, forkedFromAttemptId) => {
    const res = await postFork(alice, { title: "Bad Fork", forkedFromAttemptId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("forkedFromAttemptId must be a string or null");
    expect(await prisma.recipe.count({ where: { title: "Bad Fork", userId: alice.id } })).toBe(0);
  });
});

describe("POST /recipes with forkedFromAttemptId: only a changed version", () => {
  async function expectNoFork(attemptId: string) {
    expect(await prisma.recipe.count({ where: { forkedFromAttemptId: attemptId } })).toBe(0);
  }

  it("returns 409 when both snapshots are null and creates nothing", async () => {
    const { attemptId } = await originalWithAttempt(alice, "Shakshuka", {});

    const res = await postFork(alice, { forkedFromAttemptId: attemptId });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(SAME_AS_RECIPE);
    await expectNoFork(attemptId);
  });

  it("returns 409 when a rating and notes are the only difference", async () => {
    const { attemptId } = await originalWithAttempt(alice, "Shakshuka", { rating: 5, notes: "Perfect." });

    const res = await postFork(alice, { forkedFromAttemptId: attemptId });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(SAME_AS_RECIPE);
  });

  it("returns 409 when the snapshots are filled but equal to the recipe", async () => {
    const { attemptId } = await originalWithAttempt(alice, "Shakshuka", {
      ingredients: ORIGINAL.ingredients.map((text) => ({ text })),
      instructions: ORIGINAL.instructions,
    });

    const res = await postFork(alice, { forkedFromAttemptId: attemptId });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(SAME_AS_RECIPE);
    await expectNoFork(attemptId);
  });

  it("treats steps that differ only in whitespace and blank lines as equal", async () => {
    const { attemptId } = await originalWithAttempt(alice, "Shakshuka", {
      instructions: "  Simmer the sauce.  \n\n\nCrack in the eggs.\n",
    });

    const res = await postFork(alice, { forkedFromAttemptId: attemptId });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(SAME_AS_RECIPE);
  });

  it("creates the fork when one ingredient line changed", async () => {
    const { attemptId } = await originalWithAttempt(alice, "Shakshuka", {
      ingredients: [{ text: "4 eggs" }, { text: "1 can cherry tomatoes" }],
    });

    const res = await postFork(alice, { forkedFromAttemptId: attemptId });

    expect(res.status).toBe(201);
    expect(res.body.forkedFromAttemptId).toBe(attemptId);
  });

  it("creates the fork when the same ingredients are in a different order", async () => {
    const { attemptId } = await originalWithAttempt(alice, "Shakshuka", {
      ingredients: [{ text: "1 can tomatoes" }, { text: "4 eggs" }],
    });

    const res = await postFork(alice, { forkedFromAttemptId: attemptId });

    expect(res.status).toBe(201);
  });

  it("creates the fork when one step changed", async () => {
    const { attemptId } = await originalWithAttempt(alice, "Shakshuka", {
      instructions: "Simmer the sauce with cumin.\nCrack in the eggs.",
    });

    const res = await postFork(alice, { forkedFromAttemptId: attemptId });

    expect(res.status).toBe(201);
    expect(res.body.forkedFromAttemptId).toBe(attemptId);
  });

  it("creates the fork when the recipe was edited after an as-is attempt", async () => {
    const { recipeId, attemptId } = await originalWithAttempt(alice, "Shakshuka", {});
    const edit = await request(app)
      .patch(`/recipes/${recipeId}`)
      .set(authed(alice))
      .send({ ingredients: ["4 eggs", "1 can tomatoes", "1 tsp cumin"] });
    expect(edit.status).toBe(200);
    // The as-is attempt now holds the old lines, which differ from today's recipe.
    const attempt = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.tweaked).toBe(false);

    const res = await postFork(alice, { forkedFromAttemptId: attemptId });

    expect(res.status).toBe(201);
    expect(res.body.forkedFromAttemptId).toBe(attemptId);
  });

  it("returns 404, not 409, for another user's unchanged attempt", async () => {
    const { attemptId } = await originalWithAttempt(bob, "Shakshuka", {});

    const res = await postFork(alice, { forkedFromAttemptId: attemptId });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Attempt not found");
  });

  it("reports 'already saved' before 'same as the recipe'", async () => {
    // Forked while it differed, then the recipe was edited back to match it.
    const { recipeId, attemptId } = await originalWithAttempt(alice, "Shakshuka", {
      ingredients: [{ text: "4 eggs" }],
    });
    expect((await postFork(alice, { forkedFromAttemptId: attemptId })).status).toBe(201);
    const edit = await request(app).patch(`/recipes/${recipeId}`).set(authed(alice)).send({ ingredients: ["4 eggs"] });
    expect(edit.status).toBe(200);

    const res = await postFork(alice, { title: "Another Shakshuka", forkedFromAttemptId: attemptId });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(ALREADY_FORKED);
  });
});

describe("fork links in recipe responses", () => {
  let originalId: string;
  let olderAttemptId: string;
  let newerAttemptId: string;
  let olderForkId: string;
  let newerForkId: string;

  beforeAll(async () => {
    ({ recipeId: originalId, attemptId: olderAttemptId } = await originalWithAttempt(alice, "Links Original"));
    newerAttemptId = await createAttempt(alice, originalId, CHANGED_ATTEMPT);
    olderForkId = (await postFork(alice, { title: "Older Fork", forkedFromAttemptId: olderAttemptId })).body.id;
    newerForkId = (await postFork(alice, { title: "Newer Fork", forkedFromAttemptId: newerAttemptId })).body.id;
    // createdAt decides the order; don't rely on two inserts landing in different milliseconds.
    await prisma.recipe.update({ where: { id: olderForkId }, data: { createdAt: new Date("2026-09-22T12:00:00.000Z") } });
    await prisma.recipe.update({ where: { id: newerForkId }, data: { createdAt: new Date("2026-09-23T12:00:00.000Z") } });
  });

  it("lists the original's forks newest first on detail, with forkedFrom null", async () => {
    const res = await request(app).get(`/recipes/${originalId}`).set(authed(alice));

    expect(res.status).toBe(200);
    expect(res.body.forkedFrom).toBeNull();
    expect(res.body.forks).toEqual([
      { id: newerForkId, title: "Newer Fork" },
      { id: olderForkId, title: "Older Fork" },
    ]);
  });

  it("shows forkedFrom on the fork's detail", async () => {
    const res = await request(app).get(`/recipes/${olderForkId}`).set(authed(alice));

    expect(res.status).toBe(200);
    expect(res.body.forkedFrom).toEqual({
      id: originalId,
      title: "Links Original",
      attemptId: olderAttemptId,
      madeAt: MADE_AT,
    });
    expect(res.body.forks).toEqual([]);
  });

  it("includes forkedFrom and forks on every list item", async () => {
    const res = await request(app).get("/recipes").set(authed(alice));

    expect(res.status).toBe(200);
    const byId = new Map(res.body.map((r: { id: string }) => [r.id, r]));
    expect(byId.get(originalId)).toMatchObject({ forkedFrom: null, forks: [{ id: newerForkId }, { id: olderForkId }] });
    expect(byId.get(newerForkId)).toMatchObject({
      forkedFrom: { id: originalId, title: "Links Original", attemptId: newerAttemptId },
      forks: [],
    });
    for (const recipe of res.body) {
      expect(recipe).toHaveProperty("forkedFrom");
      expect(Array.isArray(recipe.forks)).toBe(true);
    }
  });

  it("returns the links on PATCH and reflects a renamed original in the fork's forkedFrom", async () => {
    const patch = await request(app).patch(`/recipes/${originalId}`).set(authed(alice)).send({ title: "Renamed Original" });

    expect(patch.status).toBe(200);
    expect(patch.body).toMatchObject({ title: "Renamed Original", forkedFrom: null });
    expect(patch.body.forks).toHaveLength(2);

    const fork = await request(app).get(`/recipes/${olderForkId}`).set(authed(alice));
    expect(fork.body.forkedFrom.title).toBe("Renamed Original");
  });

  it("ignores fork fields on PATCH", async () => {
    const other = await originalWithAttempt(alice, "Unrelated");

    const res = await request(app)
      .patch(`/recipes/${olderForkId}`)
      .set(authed(alice))
      .send({ forkedFromAttemptId: other.attemptId, forkedFromRecipeId: other.recipeId });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ forkedFromRecipeId: originalId, forkedFromAttemptId: olderAttemptId });
  });

  it("still returns 404 for another user's fork", async () => {
    const res = await request(app).get(`/recipes/${olderForkId}`).set(authed(bob));
    expect(res.status).toBe(404);
  });
});

describe("attempt detail fork", () => {
  let recipeId: string;
  let forkedAttemptId: string;
  let plainAttemptId: string;
  let forkId: string;

  beforeAll(async () => {
    ({ recipeId, attemptId: forkedAttemptId } = await originalWithAttempt(alice));
    plainAttemptId = await createAttempt(alice, recipeId);
    forkId = (await postFork(alice, { forkedFromAttemptId: forkedAttemptId })).body.id;
  });

  it("GET includes fork { id, title } once the attempt was saved as a recipe", async () => {
    const res = await request(app).get(`/attempts/${forkedAttemptId}`).set(authed(alice));
    expect(res.status).toBe(200);
    expect(res.body.fork).toEqual({ id: forkId, title: "Spicy Shakshuka" });
  });

  it("GET includes fork null for an attempt that wasn't saved", async () => {
    const res = await request(app).get(`/attempts/${plainAttemptId}`).set(authed(alice));
    expect(res.status).toBe(200);
    expect(res.body.fork).toBeNull();
  });

  it("PATCH returns the same fork link as GET", async () => {
    const res = await request(app).patch(`/attempts/${forkedAttemptId}`).set(authed(alice)).send({ rating: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rating: 5, fork: { id: forkId, title: "Spicy Shakshuka" } });
  });

  it("GET shows fork null again after the fork is deleted, and the attempt can be forked again", async () => {
    const del = await request(app).delete(`/recipes/${forkId}`).set(authed(alice));
    expect(del.status).toBe(204);

    const res = await request(app).get(`/attempts/${forkedAttemptId}`).set(authed(alice));
    expect(res.body.fork).toBeNull();

    const again = await postFork(alice, { forkedFromAttemptId: forkedAttemptId });
    expect(again.status).toBe(201);
  });
});

describe("deleting recipes with forks", () => {
  it("deleting the original keeps the fork, with both links null", async () => {
    const { recipeId, attemptId } = await originalWithAttempt(alice);
    const forkId = (await postFork(alice, { forkedFromAttemptId: attemptId })).body.id;
    const forkAttemptId = await createAttempt(alice, forkId);

    const del = await request(app).delete(`/recipes/${recipeId}`).set(authed(alice));
    expect(del.status).toBe(204);

    const res = await request(app).get(`/recipes/${forkId}`).set(authed(alice));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: "Spicy Shakshuka",
      forkedFromRecipeId: null,
      forkedFromAttemptId: null,
      forkedFrom: null,
      forks: [],
    });
    // The fork keeps its own history.
    expect(await prisma.attempt.count({ where: { id: forkAttemptId } })).toBe(1);

    const list = await request(app).get("/recipes").set(authed(alice));
    expect(list.body.find((r: { id: string }) => r.id === forkId).forkedFrom).toBeNull();
  });

  it("deleting a fork keeps the original and drops it from forks", async () => {
    const { recipeId, attemptId } = await originalWithAttempt(alice);
    const forkId = (await postFork(alice, { forkedFromAttemptId: attemptId })).body.id;

    const del = await request(app).delete(`/recipes/${forkId}`).set(authed(alice));
    expect(del.status).toBe(204);

    const res = await request(app).get(`/recipes/${recipeId}`).set(authed(alice));
    expect(res.status).toBe(200);
    expect(res.body.forks).toEqual([]);
    expect(await prisma.attempt.count({ where: { id: attemptId } })).toBe(1);
  });
});
