import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import type { Nutrient } from "../src/generated/prisma/client.js";
import { getStorageDir } from "../src/importPhotos.js";
import { MAX_MEAL_TEXT, mealNutrients, mealTextPieces, RECENT_SNACK_COUNT, toMealResponse } from "../src/routes/meals.js";
import {
  authed,
  b64,
  createTestUser,
  deleteTestUsers,
  GIF_HEADER,
  makeJpeg,
  makePng,
  TestUser,
} from "./helpers.js";

// Phase 6 meal log: POST/GET/PATCH/DELETE /meals, the photo on disk, the
// nutrients a meal's text brings, and recent snacks.

const MISSING_ID = "cl_does_not_exist_000000";

// Made-up foods, so no other file's catalog rows (or the seeded catalog)
// match these texts, and these rows match no other file's lines.
const QUORBLAT = "quorblat"; // PROTEIN
const FENWISK = "fenwisk"; // FIBER
const GLIMBAR = "glimbar"; // HEALTHY_FAT + FIBER
const PLONKFRUIT = "plonkfruit"; // FIBER
const SNORBEL_BUTTER = "snorbel butter"; // PROTEIN + HEALTHY_FAT
const ingredientIds: string[] = [];

async function createCatalogRow(normalizedName: string, nutrients: Nutrient[]): Promise<void> {
  // A row left over from an interrupted run would break the unique name.
  await prisma.ingredient.deleteMany({ where: { normalizedName } });
  const ingredient = await prisma.ingredient.create({
    data: { name: normalizedName, normalizedName, aliases: [], mainGroup: nutrients[0] ?? "CARB", nutrients },
  });
  ingredientIds.push(ingredient.id);
}

const storageDir = getStorageDir()!;
let alice: TestUser;
let bob: TestUser;

function postMeal(user: TestUser, body: object) {
  return request(app).post("/meals").set(authed(user)).send(body);
}

function patchMeal(user: TestUser, id: string, body: object) {
  return request(app).patch(`/meals/${id}`).set(authed(user)).send(body);
}

// Creates a meal through the route and returns the response body.
async function createMeal(user: TestUser, body: object) {
  const res = await postMeal(user, body);
  if (res.status !== 201) throw new Error(`Meal create failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body as { id: string; [key: string]: unknown };
}

function mealCount(user: TestUser) {
  return prisma.meal.count({ where: { userId: user.id } });
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const MEAL_KEYS = ["createdAt", "eatenAt", "fullness", "hasPhoto", "id", "kind", "nutrients", "text", "updatedAt"];

beforeAll(async () => {
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
  await createCatalogRow(QUORBLAT, ["PROTEIN"]);
  await createCatalogRow(FENWISK, ["FIBER"]);
  await createCatalogRow(GLIMBAR, ["HEALTHY_FAT", "FIBER"]);
  await createCatalogRow(PLONKFRUIT, ["FIBER"]);
  await createCatalogRow(SNORBEL_BUTTER, ["PROTEIN", "HEALTHY_FAT"]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await deleteTestUsers(alice, bob);
  for (const user of [alice, bob]) {
    await rm(path.join(storageDir, "meals", user.id), { recursive: true, force: true });
  }
  await prisma.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
  await prisma.$disconnect();
});

describe("mealTextPieces", () => {
  it.each([
    ["a comma list", "leftover pasta, spinach", ["leftover pasta", "spinach"]],
    ["a plus", "apple + peanut butter", ["apple", "peanut butter"]],
    ["a plus without spaces", "apple+peanut butter", ["apple", "peanut butter"]],
    ["an ampersand", "fish & chips", ["fish", "chips"]],
    ["a semicolon", "soup; bread", ["soup", "bread"]],
    ["newlines", "soup\nbread\r\nsalad", ["soup", "bread", "salad"]],
    ["\" and \"", "rice and beans", ["rice", "beans"]],
    ["\" with \"", "yogurt with berries", ["yogurt", "berries"]],
    ["Turkish \" ve \" and \" ile \"", "mercimek ve bulgur ile yoğurt", ["mercimek", "bulgur", "yoğurt"]],
    ["upper-case joiners", "Toast AND Jam WITH Butter", ["Toast", "Jam", "Butter"]],
    ["a mix", "pasta, salad and bread + olives; tea", ["pasta", "salad", "bread", "olives", "tea"]],
  ])("splits %s", (_label, text, pieces) => {
    expect(mealTextPieces(text)).toEqual(pieces);
  });

  it.each([
    ["words containing a joiner", "sandwich, candy, withered leaves, vegan", ["sandwich", "candy", "withered leaves", "vegan"]],
    ["a single food", "  spinach  ", ["spinach"]],
    ["a joiner at the very end", "pasta and", ["pasta and"]],
  ])("keeps %s whole", (_label, text, pieces) => {
    expect(mealTextPieces(text)).toEqual(pieces);
  });

  it.each([
    ["an empty string", ""],
    ["whitespace", "   "],
    ["separators only", " , ;; + & \n "],
  ])("returns no pieces for %s", (_label, text) => {
    expect(mealTextPieces(text)).toEqual([]);
  });
});

describe("mealNutrients", () => {
  it.each([null, ""])("returns [] for %j", async (text) => {
    expect(await mealNutrients(text)).toEqual([]);
  });

  it("returns the union over the pieces, each once, in enum order", async () => {
    expect(await mealNutrients(`${GLIMBAR}, ${QUORBLAT}, ${FENWISK}`)).toEqual(["PROTEIN", "FIBER", "HEALTHY_FAT"]);
  });

  it("returns [] when no piece matches the catalog", async () => {
    expect(await mealNutrients("blorptang, zeeblewort")).toEqual([]);
  });
});

describe("toMealResponse", () => {
  const row = {
    id: "m1",
    kind: "MEAL" as const,
    eatenAt: new Date("2026-09-21T12:00:00.000Z"),
    text: "soup",
    nutrients: [],
    fullness: null,
    createdAt: new Date("2026-09-21T12:00:00.000Z"),
    updatedAt: new Date("2026-09-21T12:00:00.000Z"),
  };

  it("replaces photoPath with hasPhoto: true", () => {
    const response = toMealResponse({ ...row, photoPath: "meals/u/m1.jpg" });
    expect(response).not.toHaveProperty("photoPath");
    expect(response.hasPhoto).toBe(true);
  });

  it("replaces a null photoPath with hasPhoto: false", () => {
    const response = toMealResponse({ ...row, photoPath: null });
    expect(response).not.toHaveProperty("photoPath");
    expect(response.hasPhoto).toBe(false);
  });
});

describe("auth guard", () => {
  it.each([
    ["GET", "/meals"],
    ["GET", "/meals/recent-snacks"],
    ["POST", "/meals"],
    ["GET", `/meals/${MISSING_ID}`],
    ["GET", `/meals/${MISSING_ID}/photo`],
    ["PATCH", `/meals/${MISSING_ID}`],
    ["DELETE", `/meals/${MISSING_ID}`],
  ])("rejects %s %s without a session", async (method, url) => {
    const res = await request(app)[method.toLowerCase() as "get"](url);
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await request(app).get("/meals").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("rejects a POST without a session and creates nothing", async () => {
    const before = await prisma.meal.count();
    const res = await request(app).post("/meals").send({ text: "soup" });
    expect(res.status).toBe(401);
    expect(await prisma.meal.count()).toBe(before);
  });
});

describe("POST /meals", () => {
  it("creates a text-only meal with defaults and returns the meal shape", async () => {
    const before = Date.now();
    const res = await postMeal(alice, { text: "  leftover soup  " });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(MEAL_KEYS);
    expect(res.body).toMatchObject({ kind: "MEAL", text: "leftover soup", fullness: null, hasPhoto: false });
    const eatenAt = new Date(res.body.eatenAt).getTime();
    expect(eatenAt).toBeGreaterThanOrEqual(before - 1000);
    expect(eatenAt).toBeLessThanOrEqual(Date.now() + 1000);

    const row = await prisma.meal.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).toMatchObject({ userId: alice.id, text: "leftover soup", photoPath: null });
  });

  it("stores kind, fullness and an eatenAt with an offset", async () => {
    const res = await postMeal(alice, {
      kind: "SNACK",
      fullness: "STILL_HUNGRY",
      eatenAt: "2026-09-21T15:00:00+03:00",
      text: "crackers",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: "SNACK",
      fullness: "STILL_HUNGRY",
      eatenAt: "2026-09-21T12:00:00.000Z",
    });
  });

  it.each(["STILL_HUNGRY", "SATISFIED", "VERY_FULL", null])("accepts fullness %j", async (fullness) => {
    const res = await postMeal(alice, { text: "soup", fullness });
    expect(res.status).toBe(201);
    expect(res.body.fullness).toBe(fullness);
  });

  it(`accepts text of exactly ${MAX_MEAL_TEXT} characters`, async () => {
    const text = "x".repeat(MAX_MEAL_TEXT);
    const res = await postMeal(alice, { text });
    expect(res.status).toBe(201);
    expect(res.body.text).toBe(text);
  });

  describe("nutrients from the text", () => {
    it.each([
      ["one protein food", QUORBLAT, ["PROTEIN"]],
      ["a protein and a fiber food split by a comma", `${QUORBLAT}, ${FENWISK}`, ["PROTEIN", "FIBER"]],
      ["a protein and a fiber food split by \" with \"", `${QUORBLAT} with ${FENWISK}`, ["PROTEIN", "FIBER"]],
      ["a protein and a fiber food split by \" ve \"", `${QUORBLAT} ve ${FENWISK}`, ["PROTEIN", "FIBER"]],
      // Unsplit, the matcher would only link the longer "snorbel butter".
      ["\"fruit + nut butter\"", `${PLONKFRUIT} + ${SNORBEL_BUTTER}`, ["PROTEIN", "FIBER", "HEALTHY_FAT"]],
      ["a food with two nutrients", GLIMBAR, ["FIBER", "HEALTHY_FAT"]],
      ["overlapping foods (each nutrient once, enum order)", `${GLIMBAR}\n${FENWISK}; ${QUORBLAT}`, ["PROTEIN", "FIBER", "HEALTHY_FAT"]],
      ["an unmatched food next to a matched one", `blorptang, ${FENWISK}`, ["FIBER"]],
      ["no matched food", "blorptang and zeeblewort", []],
    ])("%s", async (_label, text, nutrients) => {
      const res = await postMeal(alice, { text });
      expect(res.status).toBe(201);
      expect(res.body.nutrients).toEqual(nutrients);
      expect((await prisma.meal.findUniqueOrThrow({ where: { id: res.body.id } })).nutrients).toEqual(nutrients);
    });
  });

  describe("photos", () => {
    it("saves a photo-only JPEG meal and its file under meals/{userId}/{id}.jpg", async () => {
      const jpeg = makeJpeg(640, 480, { extra: 1 });
      const res = await postMeal(alice, { photo: b64(jpeg) });

      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(MEAL_KEYS);
      expect(res.body).toMatchObject({ text: null, nutrients: [], hasPhoto: true });

      const row = await prisma.meal.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.photoPath).toBe(`meals/${alice.id}/${res.body.id}.jpg`);
      expect(await readFile(path.join(storageDir, row.photoPath!))).toEqual(jpeg);
    });

    it("saves a PNG as .png, with text and its nutrients", async () => {
      const png = makePng(1080, 2400, { extra: 2 });
      const res = await postMeal(alice, { photo: b64(png), text: `${QUORBLAT}, ${FENWISK}` });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ hasPhoto: true, text: `${QUORBLAT}, ${FENWISK}`, nutrients: ["PROTEIN", "FIBER"] });
      const row = await prisma.meal.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.photoPath).toBe(`meals/${alice.id}/${res.body.id}.png`);
      expect(await readFile(path.join(storageDir, row.photoPath!))).toEqual(png);
    });

    it("stores a photo meal with blank text as text null", async () => {
      const res = await postMeal(alice, { photo: b64(makeJpeg(10, 10)), text: "   " });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ text: null, hasPhoto: true });
    });

    it("accepts a photo above the global 100 KB JSON limit", async () => {
      const big = Buffer.concat([makeJpeg(4032, 3024), Buffer.alloc(300_000, 7)]);
      const res = await postMeal(alice, { photo: b64(big) });
      expect(res.status).toBe(201);
      expect(res.body.hasPhoto).toBe(true);
    });

    it("rejects a body above the 4 MB meal limit with 413 and creates nothing", async () => {
      const before = await mealCount(alice);
      const huge = Buffer.concat([makeJpeg(10, 10), Buffer.alloc(3_500_000, 7)]);
      const res = await postMeal(alice, { photo: b64(huge) });
      expect(res.status).toBe(413);
      expect(await mealCount(alice)).toBe(before);
    });

    it("fails with 500 and creates no row when STORAGE_DIR is not set", async () => {
      vi.stubEnv("STORAGE_DIR", "");
      const before = await mealCount(alice);
      const res = await postMeal(alice, { photo: b64(makeJpeg(10, 10)), text: "soup" });
      expect(res.status).toBe(500);
      expect(await mealCount(alice)).toBe(before);
    });
  });

  describe("validation", () => {
    it.each([
      ["an empty body", {}, "A meal needs a photo or text"],
      ["blank text and no photo", { text: "   " }, "A meal needs a photo or text"],
      ["null text and no photo", { text: null }, "A meal needs a photo or text"],
      ["only a kind and fullness", { kind: "SNACK", fullness: "SATISFIED" }, "A meal needs a photo or text"],
      ["text over the limit", { text: "x".repeat(MAX_MEAL_TEXT + 1) }, "text: Too big: expected string to have <=500 characters"],
      ["a non-string text", { text: 42 }, "text: Invalid input: expected string, received number"],
      ["an unknown kind", { text: "soup", kind: "BRUNCH" }, 'kind: Invalid option: expected one of "MEAL"|"SNACK"'],
      [
        "an unknown fullness",
        { text: "soup", fullness: "STUFFED" },
        'fullness: Invalid option: expected one of "STILL_HUNGRY"|"SATISFIED"|"VERY_FULL"',
      ],
      ["an eatenAt without an offset", { text: "soup", eatenAt: "2026-09-21T12:00:00" }, "eatenAt: Invalid ISO datetime"],
      ["a date-only eatenAt", { text: "soup", eatenAt: "2026-09-21" }, "eatenAt: Invalid ISO datetime"],
      ["a non-date eatenAt", { text: "soup", eatenAt: "yesterday" }, "eatenAt: Invalid ISO datetime"],
      ["a photo that isn't base64", { photo: "not base64!!" }, "photo: photo must be a base64 string"],
      ["an empty photo", { photo: "" }, "photo: photo must be a base64 string"],
      ["base64 of text", { photo: b64(Buffer.from("definitely not an image")) }, "photo is not a JPEG or PNG"],
      ["a GIF", { photo: b64(GIF_HEADER) }, "photo is not a JPEG or PNG"],
      ["a zero-sized JPEG", { photo: b64(makeJpeg(0, 10)) }, "photo is not a JPEG or PNG"],
      ["an unknown field", { text: "soup", photoPath: "meals/x.jpg" }, 'Unrecognized key: "photoPath"'],
      ["a userId in the body", { text: "soup", userId: "someone-else" }, 'Unrecognized key: "userId"'],
    ])("rejects %s with 400 and creates nothing", async (_label, body, message) => {
      const before = await mealCount(alice);
      const res = await postMeal(alice, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(message);
      expect(await mealCount(alice)).toBe(before);
    });
  });
});

describe("GET /meals", () => {
  const T1 = "2026-09-20T12:00:00.000Z";
  const T2 = "2026-09-21T12:00:00.000Z";
  const T3 = "2026-09-22T12:00:00.000Z";
  let carol: TestUser;
  let ids: Record<string, string>;

  function list(user: TestUser, query: Record<string, string> = {}) {
    return request(app).get("/meals").query(query).set(authed(user));
  }

  function eatenAts(body: { eatenAt: string }[]) {
    return body.map((meal) => meal.eatenAt);
  }

  // Own user: the rest of this file adds meals to alice at "now".
  beforeAll(async () => {
    carol = await createTestUser("Carol");
    // Created out of order, so the order comes from eatenAt.
    ids = {
      t2: (await createMeal(carol, { text: "lunch", eatenAt: T2 })).id,
      t1: (await createMeal(carol, { text: "breakfast", eatenAt: T1, kind: "SNACK" })).id,
      t3: (await createMeal(carol, { text: "dinner", eatenAt: T3 })).id,
    };
    await createMeal(bob, { text: "bob's lunch", eatenAt: T2 });
  });

  afterAll(async () => {
    await deleteTestUsers(carol);
  });

  it("lists only the viewer's meals, newest first, in the meal shape", async () => {
    const res = await list(carol);
    expect(res.status).toBe(200);
    expect(res.body.map((meal: { id: string }) => meal.id)).toEqual([ids.t3, ids.t2, ids.t1]);
    for (const meal of res.body) expect(Object.keys(meal).sort()).toEqual(MEAL_KEYS);
  });

  it("includes a meal eaten exactly at from", async () => {
    expect(eatenAts((await list(carol, { from: T2 })).body)).toEqual([T3, T2]);
  });

  it("excludes a meal eaten exactly at to", async () => {
    expect(eatenAts((await list(carol, { to: T2 })).body)).toEqual([T1]);
  });

  it("applies both bounds", async () => {
    expect(eatenAts((await list(carol, { from: T1, to: T3 })).body)).toEqual([T2, T1]);
  });

  it("reads bounds with an offset in UTC", async () => {
    // 15:00+03:00 is T2 exactly, so T2 is in.
    const res = await list(carol, { from: "2026-09-21T15:00:00+03:00", to: "2026-09-22T14:59:59+03:00" });
    expect(eatenAts(res.body)).toEqual([T2]);
  });

  it("returns [] when from is after to", async () => {
    const res = await list(carol, { from: T3, to: T1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns [] for a user without meals", async () => {
    const dave = await createTestUser("Dave");
    try {
      const res = await list(dave);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    } finally {
      await deleteTestUsers(dave);
    }
  });

  it.each([
    ["an invalid from", { from: "yesterday" }, "from: Invalid ISO datetime"],
    ["a to without an offset", { to: "2026-09-21T12:00:00" }, "to: Invalid ISO datetime"],
    ["an unknown parameter", { kind: "SNACK" }, 'Unrecognized key: "kind"'],
  ])("rejects %s with 400", async (_label, query, message) => {
    const res = await list(carol, query);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });
});

describe("GET /meals/recent-snacks", () => {
  let erin: TestUser;
  const base = Date.parse("2026-09-01T12:00:00.000Z");
  const minutes = (n: number) => new Date(base + n * 60_000);

  function recent(user: TestUser) {
    return request(app).get("/meals/recent-snacks").set(authed(user));
  }

  beforeAll(async () => {
    erin = await createTestUser("Erin");
  });

  afterAll(async () => {
    await deleteTestUsers(erin);
  });

  it("returns [] when the viewer has no snacks", async () => {
    const res = await recent(erin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it(`returns up to ${RECENT_SNACK_COUNT} distinct snack texts, newest first, only the viewer's snacks`, async () => {
    await prisma.meal.createMany({
      data: [
        // Ten distinct snacks, oldest first (snack 1 at minute 1 … snack 10 at minute 10).
        ...Array.from({ length: 10 }, (_, i) => ({
          userId: erin.id,
          kind: "SNACK" as const,
          text: `snack ${i + 1}`,
          eatenAt: minutes(i + 1),
        })),
        // A newer repeat of snack 3 in other case: one entry, the newest spelling, at the top.
        { userId: erin.id, kind: "SNACK", text: "SNACK 3", eatenAt: minutes(20) },
        // Newer still, but not snacks of hers with text.
        { userId: erin.id, kind: "MEAL", text: "big dinner", eatenAt: minutes(30) },
        { userId: erin.id, kind: "SNACK", text: null, photoPath: "meals/x/y.jpg", eatenAt: minutes(31) },
        { userId: bob.id, kind: "SNACK", text: "bob's snack", eatenAt: minutes(32) },
      ],
    });

    const res = await recent(erin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(["SNACK 3", "snack 10", "snack 9", "snack 8", "snack 7", "snack 6", "snack 5", "snack 4"]);
  });

  // BUG: dedupe lower-cases with the Turkish locale, so an English capital I
  // becomes dotless ı: "KIWI" → "kıwı", which isn't "kiwi".
  it("treats snacks that differ only in case as one, including a capital I", async () => {
    const frank = await createTestUser("Frank");
    try {
      await prisma.meal.createMany({
        data: [
          { userId: frank.id, kind: "SNACK", text: "kiwi", eatenAt: minutes(1) },
          { userId: frank.id, kind: "SNACK", text: "KIWI", eatenAt: minutes(2) },
        ],
      });
      expect((await recent(frank)).body).toEqual(["KIWI"]);
    } finally {
      await deleteTestUsers(frank);
    }
  });
});

describe("GET /meals/:id", () => {
  it("returns the viewer's meal", async () => {
    const meal = await createMeal(alice, { text: QUORBLAT, kind: "SNACK", fullness: "SATISFIED" });
    const res = await request(app).get(`/meals/${meal.id}`).set(authed(alice));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(meal);
  });

  it("returns 404 for another user's meal", async () => {
    const meal = await createMeal(alice, { text: "private" });
    const res = await request(app).get(`/meals/${meal.id}`).set(authed(bob));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Meal not found");
  });

  it("returns 404 for a nonexistent meal", async () => {
    const res = await request(app).get(`/meals/${MISSING_ID}`).set(authed(alice));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Meal not found");
  });
});

describe("GET /meals/:id/photo", () => {
  function getPhoto(user: TestUser, id: string) {
    return request(app).get(`/meals/${id}/photo`).set(authed(user));
  }

  it("sends the viewer's JPEG", async () => {
    const jpeg = makeJpeg(640, 480, { extra: 31 });
    const meal = await createMeal(alice, { photo: b64(jpeg) });
    const res = await getPhoto(alice, meal.id);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(Buffer.compare(res.body, jpeg)).toBe(0);
  });

  it("sends the viewer's PNG", async () => {
    const png = makePng(20, 30, { extra: 32 });
    const meal = await createMeal(alice, { photo: b64(png) });
    const res = await getPhoto(alice, meal.id);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(res.body, png)).toBe(0);
  });

  it("returns 404 for a meal without a photo", async () => {
    const meal = await createMeal(alice, { text: "soup" });
    const res = await getPhoto(alice, meal.id);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Photo not found");
  });

  it("returns 404 for another user's photo", async () => {
    const meal = await createMeal(alice, { photo: b64(makeJpeg(10, 10)) });
    const res = await getPhoto(bob, meal.id);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Photo not found");
  });

  it("returns 404 for a nonexistent meal", async () => {
    const res = await getPhoto(alice, MISSING_ID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Photo not found");
  });

  it("returns 404 when the file is gone from disk", async () => {
    const meal = await createMeal(alice, { photo: b64(makeJpeg(10, 10)) });
    await rm(path.join(storageDir, "meals", alice.id, `${meal.id}.jpg`));
    const res = await getPhoto(alice, meal.id);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Photo not found");
  });
});

describe("PATCH /meals/:id", () => {
  it("changes kind, eatenAt and fullness and leaves the rest", async () => {
    const meal = await createMeal(alice, { text: QUORBLAT, eatenAt: "2026-09-21T12:00:00.000Z" });
    const res = await patchMeal(alice, meal.id, {
      kind: "SNACK",
      eatenAt: "2026-09-21T10:30:00+02:00",
      fullness: "VERY_FULL",
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: "SNACK",
      eatenAt: "2026-09-21T08:30:00.000Z",
      fullness: "VERY_FULL",
      text: QUORBLAT,
      nutrients: ["PROTEIN"],
      hasPhoto: false,
    });
    const row = await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } });
    expect(row).toMatchObject({ kind: "SNACK", fullness: "VERY_FULL", text: QUORBLAT });
  });

  it("recomputes the nutrients when the text changes", async () => {
    const meal = await createMeal(alice, { text: QUORBLAT });
    const res = await patchMeal(alice, meal.id, { text: `${FENWISK} + ${SNORBEL_BUTTER}` });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ text: `${FENWISK} + ${SNORBEL_BUTTER}`, nutrients: ["PROTEIN", "FIBER", "HEALTHY_FAT"] });
    expect((await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } })).nutrients).toEqual([
      "PROTEIN",
      "FIBER",
      "HEALTHY_FAT",
    ]);
  });

  it("keeps the stored nutrients when the text is omitted", async () => {
    const meal = await createMeal(alice, { text: GLIMBAR });
    const res = await patchMeal(alice, meal.id, { fullness: "SATISFIED" });
    expect(res.status).toBe(200);
    expect(res.body.nutrients).toEqual(["FIBER", "HEALTHY_FAT"]);
  });

  it("clears fullness with null", async () => {
    const meal = await createMeal(alice, { text: "soup", fullness: "STILL_HUNGRY" });
    const res = await patchMeal(alice, meal.id, { fullness: null });
    expect(res.status).toBe(200);
    expect(res.body.fullness).toBeNull();
    expect((await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } })).fullness).toBeNull();
  });

  it("returns the meal unchanged for an empty body", async () => {
    const meal = await createMeal(alice, { text: QUORBLAT, fullness: "SATISFIED" });
    const res = await patchMeal(alice, meal.id, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ text: QUORBLAT, fullness: "SATISFIED", nutrients: ["PROTEIN"], kind: "MEAL" });
  });

  it.each([null, "   "])("clears the text (%j) and nutrients of a photo meal", async (text) => {
    const meal = await createMeal(alice, { photo: b64(makeJpeg(10, 10)), text: QUORBLAT });
    const res = await patchMeal(alice, meal.id, { text });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ text: null, nutrients: [], hasPhoto: true });
  });

  it.each([null, "", "   "])("rejects clearing the text (%j) of a meal without a photo", async (text) => {
    const meal = await createMeal(alice, { text: QUORBLAT });
    const res = await patchMeal(alice, meal.id, { text });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("A meal needs a photo or text");
    const row = await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } });
    expect(row).toMatchObject({ text: QUORBLAT, nutrients: ["PROTEIN"] });
  });

  it.each([
    ["a photo", { photo: b64(makeJpeg(10, 10)) }, 'Unrecognized key: "photo"'],
    ["an unknown kind", { kind: "BRUNCH" }, 'kind: Invalid option: expected one of "MEAL"|"SNACK"'],
    [
      "an unknown fullness",
      { fullness: "HUNGRY" },
      'fullness: Invalid option: expected one of "STILL_HUNGRY"|"SATISFIED"|"VERY_FULL"',
    ],
    ["an eatenAt without an offset", { eatenAt: "2026-09-21T12:00:00" }, "eatenAt: Invalid ISO datetime"],
    ["text over the limit", { text: "x".repeat(MAX_MEAL_TEXT + 1) }, "text: Too big: expected string to have <=500 characters"],
  ])("rejects %s with 400 and changes nothing", async (_label, body, message) => {
    const meal = await createMeal(alice, { text: QUORBLAT });
    const res = await patchMeal(alice, meal.id, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    const row = await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } });
    expect(row).toMatchObject({ text: QUORBLAT, kind: "MEAL", fullness: null, photoPath: null });
  });

  it("returns 404 for another user's meal and changes nothing", async () => {
    const meal = await createMeal(alice, { text: QUORBLAT });
    const res = await patchMeal(bob, meal.id, { text: "hijacked", fullness: "VERY_FULL" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Meal not found");
    const row = await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } });
    expect(row).toMatchObject({ text: QUORBLAT, fullness: null });
  });

  it("returns 404 for a nonexistent meal", async () => {
    const res = await patchMeal(alice, MISSING_ID, { fullness: "SATISFIED" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Meal not found");
  });
});

describe("DELETE /meals/:id", () => {
  function deleteMeal(user: TestUser, id: string) {
    return request(app).delete(`/meals/${id}`).set(authed(user));
  }

  it("deletes a photo meal and its file", async () => {
    const meal = await createMeal(alice, { photo: b64(makeJpeg(10, 10)) });
    const file = path.join(storageDir, "meals", alice.id, `${meal.id}.jpg`);
    expect(await exists(file)).toBe(true);

    const res = await deleteMeal(alice, meal.id);
    expect(res.status).toBe(204);
    expect(await prisma.meal.findUnique({ where: { id: meal.id } })).toBeNull();
    expect(await exists(file)).toBe(false);
    expect((await request(app).get(`/meals/${meal.id}`).set(authed(alice))).status).toBe(404);
  });

  it("deletes a text-only meal", async () => {
    const meal = await createMeal(alice, { text: "soup" });
    const res = await deleteMeal(alice, meal.id);
    expect(res.status).toBe(204);
    expect(await prisma.meal.findUnique({ where: { id: meal.id } })).toBeNull();
  });

  it("deletes a photo meal whose file is already gone", async () => {
    const meal = await createMeal(alice, { photo: b64(makePng(10, 10)) });
    await rm(path.join(storageDir, "meals", alice.id, `${meal.id}.png`));
    const res = await deleteMeal(alice, meal.id);
    expect(res.status).toBe(204);
    expect(await prisma.meal.findUnique({ where: { id: meal.id } })).toBeNull();
  });

  it("returns 404 for another user's meal and keeps the row and file", async () => {
    const meal = await createMeal(alice, { photo: b64(makeJpeg(10, 10)) });
    const file = path.join(storageDir, "meals", alice.id, `${meal.id}.jpg`);
    const res = await deleteMeal(bob, meal.id);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Meal not found");
    expect(await prisma.meal.findUnique({ where: { id: meal.id } })).not.toBeNull();
    expect(await exists(file)).toBe(true);
  });

  it("returns 404 for a nonexistent meal", async () => {
    const res = await deleteMeal(alice, MISSING_ID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Meal not found");
  });
});

describe("cascade", () => {
  it("deleting a user removes their meals", async () => {
    const gina = await createTestUser("Gina");
    await createMeal(gina, { text: "soup" });
    await deleteTestUsers(gina);
    expect(await prisma.meal.count({ where: { userId: gina.id } })).toBe(0);
  });
});
