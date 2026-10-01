import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { getStorageDir, writeRowPhoto } from "../src/importPhotos.js";
import { toAttemptResponse } from "../src/routes/attempts.js";
import {
  authed,
  b64,
  createAttempt,
  createRecipe,
  createTestUser,
  deleteTestUsers,
  GIF_HEADER,
  makeJpeg,
  makePng,
  TestUser,
} from "./helpers.js";

// The "what came out" photo on an attempt (sent once, at Finish) and the
// "Was it enjoyable to make?" answer.

const MISSING_ID = "cl_does_not_exist_000000";

const storageDir = getStorageDir()!;
let alice: TestUser;
let bob: TestUser;
let aliceRecipeId: string;
let bobRecipeId: string;

function postAttempt(user: TestUser, recipeId: string, body: object) {
  return request(app).post(`/recipes/${recipeId}/attempts`).set(authed(user)).send(body);
}

function patchAttempt(user: TestUser, id: string, body: object) {
  return request(app).patch(`/attempts/${id}`).set(authed(user)).send(body);
}

function getPhoto(user: TestUser, id: string) {
  return request(app).get(`/attempts/${id}/photo`).set(authed(user));
}

// Creates an attempt through the route and returns the response body.
async function createPhotoAttempt(user: TestUser, recipeId: string, body: object) {
  const res = await postAttempt(user, recipeId, body);
  if (res.status !== 201) throw new Error(`Attempt create failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body as { id: string; [key: string]: unknown };
}

function attemptCount(recipeId: string) {
  return prisma.attempt.count({ where: { recipeId } });
}

beforeAll(async () => {
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
  aliceRecipeId = await createRecipe(alice);
  bobRecipeId = await createRecipe(bob);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await deleteTestUsers(alice, bob);
  for (const user of [alice, bob]) {
    await rm(path.join(storageDir, "attempts", user.id), { recursive: true, force: true });
  }
  await prisma.$disconnect();
});

describe("toAttemptResponse", () => {
  const row = { id: "a1", rating: 4 };

  it("replaces photoPath with hasPhoto: true", () => {
    const response = toAttemptResponse({ ...row, photoPath: "attempts/u/a1.jpg" });
    expect(response).toEqual({ id: "a1", rating: 4, hasPhoto: true });
    expect(response).not.toHaveProperty("photoPath");
  });

  it("replaces a null photoPath with hasPhoto: false", () => {
    const response = toAttemptResponse({ ...row, photoPath: null });
    expect(response).toEqual({ id: "a1", rating: 4, hasPhoto: false });
  });
});

describe("writeRowPhoto", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "flourish-row-photo-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ["attempts", "image/jpeg", "jpg"],
    ["meals", "image/png", "png"],
  ] as const)("writes a %s photo (%s) at {folder}/{userId}/{id}.%s", async (folder, mimeType, ext) => {
    const data = Buffer.from([1, 2, 3]);
    const relative = await writeRowPhoto(dir, folder, "user1", "row1", { data, mimeType });

    // Forward slashes on every platform, relative to the storage dir.
    expect(relative).toBe(`${folder}/user1/row1.${ext}`);
    expect(await readFile(path.join(dir, relative))).toEqual(data);
  });
});

describe("POST /recipes/:recipeId/attempts with a photo", () => {
  it("saves a JPEG at attempts/{userId}/{attemptId}.jpg and returns hasPhoto without photoPath", async () => {
    const jpeg = makeJpeg(640, 480, { extra: 1 });
    const res = await postAttempt(alice, aliceRecipeId, { rating: 5, photo: b64(jpeg) });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ rating: 5, hasPhoto: true });
    expect(res.body).not.toHaveProperty("photoPath");
    expect(res.body).not.toHaveProperty("photo");

    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.photoPath).toBe(`attempts/${alice.id}/${res.body.id}.jpg`);
    expect(await readFile(path.join(storageDir, row.photoPath!))).toEqual(jpeg);
  });

  it("saves a PNG as .png", async () => {
    const png = makePng(1080, 2400, { extra: 2 });
    const res = await postAttempt(alice, aliceRecipeId, { photo: b64(png) });

    expect(res.status).toBe(201);
    expect(res.body.hasPhoto).toBe(true);
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.photoPath).toBe(`attempts/${alice.id}/${res.body.id}.png`);
    expect(await readFile(path.join(storageDir, row.photoPath!))).toEqual(png);
  });

  it("returns hasPhoto false and stores photoPath null without a photo", async () => {
    const res = await postAttempt(alice, aliceRecipeId, { rating: 3 });

    expect(res.status).toBe(201);
    expect(res.body.hasPhoto).toBe(false);
    expect(res.body).not.toHaveProperty("photoPath");
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id: res.body.id } })).photoPath).toBeNull();
  });

  it("keeps the other Finish fields next to a photo", async () => {
    const res = await postAttempt(alice, aliceRecipeId, {
      photo: b64(makeJpeg(10, 10, { extra: 3 })),
      durationMinutes: 25,
      fullness: "SATISFIED",
      enjoyment: "LOVED",
      notes: "  Crispy.  ",
      instructions: "Fry.",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      durationMinutes: 25,
      fullness: "SATISFIED",
      enjoyment: "LOVED",
      notes: "Crispy.",
      instructions: "Fry.",
      tweaked: true,
      hasPhoto: true,
    });
  });

  // The global express.json() stops at 100 KB; this only passes when the
  // attempts router parses its own body before the global parser runs.
  it("accepts a Finish body above the global 100 KB JSON limit", async () => {
    const big = Buffer.concat([makeJpeg(4032, 3024), Buffer.alloc(300_000, 7)]);
    const body = { rating: 4, photo: b64(big) };
    expect(JSON.stringify(body).length).toBeGreaterThan(100 * 1024);

    const res = await postAttempt(alice, aliceRecipeId, body);

    expect(res.status).toBe(201);
    expect(res.body.hasPhoto).toBe(true);
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(await readFile(path.join(storageDir, row.photoPath!))).toEqual(big);
  });

  it("rejects a body above the 4 MB attempt limit with 413 and creates nothing", async () => {
    const before = await attemptCount(aliceRecipeId);
    const huge = Buffer.concat([makeJpeg(10, 10), Buffer.alloc(3_500_000, 7)]);

    const res = await postAttempt(alice, aliceRecipeId, { photo: b64(huge) });

    expect(res.status).toBe(413);
    expect(await attemptCount(aliceRecipeId)).toBe(before);
  });

  // Kept under 4 MB: with a bigger body the server answers 401 before the
  // client has finished uploading, and supertest sees ECONNRESET.
  it("rejects a Finish with a large photo without a session", async () => {
    const big = Buffer.concat([makeJpeg(10, 10), Buffer.alloc(300_000, 7)]);
    const res = await request(app).post(`/recipes/${aliceRecipeId}/attempts`).send({ photo: b64(big) });
    expect(res.status).toBe(401);
  });

  it("returns 404 for another user's recipe and writes no file", async () => {
    const res = await postAttempt(alice, bobRecipeId, { photo: b64(makeJpeg(10, 10)) });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Recipe not found");
    expect(await attemptCount(bobRecipeId)).toBe(0);
  });

  it.each([
    ["a photo that isn't base64", { photo: "not base64!!" }, "photo: photo must be a base64 string"],
    ["an empty photo", { photo: "" }, "photo: photo must be a base64 string"],
    ["a null photo", { photo: null }, /^photo: /],
    ["base64 of text", { photo: b64(Buffer.from("definitely not an image")) }, "photo is not a JPEG or PNG"],
    ["a GIF", { photo: b64(GIF_HEADER) }, "photo is not a JPEG or PNG"],
    ["a zero-sized JPEG", { photo: b64(makeJpeg(0, 10)) }, "photo is not a JPEG or PNG"],
    ["a PNG whose first chunk isn't IHDR", { photo: b64(makePng(10, 10, { firstChunk: "IDAT" })) }, "photo is not a JPEG or PNG"],
    ["a client-sent photoPath", { photoPath: "attempts/x.jpg" }, 'Unrecognized key: "photoPath"'],
    ["a client-sent hasPhoto", { hasPhoto: true }, 'Unrecognized key: "hasPhoto"'],
  ])("rejects %s with 400 and creates nothing", async (_label, body, message) => {
    const before = await attemptCount(aliceRecipeId);

    const res = await postAttempt(alice, aliceRecipeId, body);

    expect(res.status).toBe(400);
    if (typeof message === "string") expect(res.body.error).toBe(message);
    else expect(res.body.error).toMatch(message);
    expect(await attemptCount(aliceRecipeId)).toBe(before);
  });

  it("fails with 500 and creates no row when STORAGE_DIR is not set", async () => {
    vi.stubEnv("STORAGE_DIR", "");
    const before = await attemptCount(aliceRecipeId);

    const res = await postAttempt(alice, aliceRecipeId, { photo: b64(makeJpeg(10, 10)), rating: 4 });

    expect(res.status).toBe(500);
    expect(await attemptCount(aliceRecipeId)).toBe(before);
  });

  it("still saves an attempt without a photo when STORAGE_DIR is not set", async () => {
    vi.stubEnv("STORAGE_DIR", "");
    const res = await postAttempt(alice, aliceRecipeId, { rating: 4 });
    expect(res.status).toBe(201);
    expect(res.body.hasPhoto).toBe(false);
  });

  it("deletes the row again when the file can't be written", async () => {
    // STORAGE_DIR pointing at a file makes the mkdir inside it fail.
    const blocker = path.join(os.tmpdir(), `flourish-attempt-blocker-${Date.now()}`);
    await writeFile(blocker, "not a directory");
    vi.stubEnv("STORAGE_DIR", blocker);
    const before = await attemptCount(aliceRecipeId);

    try {
      const res = await postAttempt(alice, aliceRecipeId, { photo: b64(makeJpeg(10, 10)), rating: 2 });

      expect(res.status).toBe(500);
      expect(await attemptCount(aliceRecipeId)).toBe(before);
    } finally {
      await rm(blocker, { force: true });
    }
  });
});

describe("PATCH /attempts/:id never takes a photo", () => {
  it.each([
    ["a photo", { photo: b64(makeJpeg(10, 10)) }, 'Unrecognized key: "photo"'],
    ["a photo next to a valid rating", { rating: 4, photo: b64(makeJpeg(10, 10)) }, 'Unrecognized key: "photo"'],
    ["a photoPath", { photoPath: "attempts/x.jpg" }, 'Unrecognized key: "photoPath"'],
    ["a hasPhoto", { hasPhoto: false }, 'Unrecognized key: "hasPhoto"'],
  ])("rejects %s with 400 and changes nothing", async (_label, body, message) => {
    const attempt = await createPhotoAttempt(alice, aliceRecipeId, { rating: 3, photo: b64(makeJpeg(10, 10)) });
    const before = await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } });

    const res = await patchAttempt(alice, attempt.id, body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } })).toEqual(before);
  });

  it("keeps the photo when other fields change", async () => {
    const attempt = await createPhotoAttempt(alice, aliceRecipeId, { photo: b64(makeJpeg(10, 10)) });
    const res = await patchAttempt(alice, attempt.id, { rating: 5, enjoyment: "FINE" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rating: 5, enjoyment: "FINE", hasPhoto: true });
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } })).photoPath).toBe(
      `attempts/${alice.id}/${attempt.id}.jpg`,
    );
  });
});

describe("photoPath never leaves the server", () => {
  // Own user, so the unrated query only sees this block's attempts.
  let erin: TestUser;
  let recipeId: string;
  let photoId: string;
  let plainId: string;

  beforeAll(async () => {
    erin = await createTestUser("Erin");
    recipeId = await createRecipe(erin);
    plainId = await createAttempt(erin, recipeId, { rating: 4 });
    // Unrated and newest, so GET /attempts?unrated=true returns it.
    photoId = (await createPhotoAttempt(erin, recipeId, { photo: b64(makeJpeg(10, 10)) })).id;
  });

  afterAll(async () => {
    await deleteTestUsers(erin);
    await rm(path.join(storageDir, "attempts", erin.id), { recursive: true, force: true });
  });

  it("GET /recipes/:recipeId/attempts returns hasPhoto per attempt", async () => {
    const res = await request(app).get(`/recipes/${recipeId}/attempts`).set(authed(erin));

    expect(res.status).toBe(200);
    const byId = new Map(res.body.map((a: { id: string; hasPhoto: unknown }) => [a.id, a.hasPhoto]));
    expect(byId.get(photoId)).toBe(true);
    expect(byId.get(plainId)).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("photoPath");
  });

  it.each([
    ["a photo", () => photoId, true],
    ["no photo", () => plainId, false],
  ])("GET /attempts/:id returns hasPhoto for an attempt with %s", async (_label, getId, hasPhoto) => {
    const res = await request(app).get(`/attempts/${getId()}`).set(authed(erin));

    expect(res.status).toBe(200);
    expect(res.body.hasPhoto).toBe(hasPhoto);
    expect(res.body).not.toHaveProperty("photoPath");
  });

  it("GET /attempts?unrated=true returns hasPhoto", async () => {
    const res = await request(app).get("/attempts?unrated=true").set(authed(erin));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: photoId, hasPhoto: true });
    expect(res.body).not.toHaveProperty("photoPath");
    expect(res.body.recipe).not.toHaveProperty("photoPath");
  });

  it("PATCH /attempts/:id returns hasPhoto", async () => {
    const res = await patchAttempt(erin, photoId, { notes: "Golden." });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ notes: "Golden.", hasPhoto: true });
    expect(res.body).not.toHaveProperty("photoPath");
  });
});

describe("GET /attempts/:id/photo", () => {
  it("rejects without a session", async () => {
    const attempt = await createPhotoAttempt(alice, aliceRecipeId, { photo: b64(makeJpeg(10, 10)) });
    const res = await request(app).get(`/attempts/${attempt.id}/photo`);
    expect(res.status).toBe(401);
  });

  it("sends the viewer's JPEG", async () => {
    const jpeg = makeJpeg(640, 480, { extra: 31 });
    const attempt = await createPhotoAttempt(alice, aliceRecipeId, { photo: b64(jpeg) });

    const res = await getPhoto(alice, attempt.id);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(Buffer.compare(res.body, jpeg)).toBe(0);
  });

  it("sends the viewer's PNG", async () => {
    const png = makePng(20, 30, { extra: 32 });
    const attempt = await createPhotoAttempt(alice, aliceRecipeId, { photo: b64(png) });

    const res = await getPhoto(alice, attempt.id);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(res.body, png)).toBe(0);
  });

  it("returns 404 for an attempt without a photo", async () => {
    const attempt = await createPhotoAttempt(alice, aliceRecipeId, { rating: 3 });
    const res = await getPhoto(alice, attempt.id);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Photo not found");
  });

  it("returns 404 for another user's photo", async () => {
    const attempt = await createPhotoAttempt(alice, aliceRecipeId, { photo: b64(makeJpeg(10, 10)) });
    const res = await getPhoto(bob, attempt.id);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Photo not found");
  });

  it("returns 404 for a nonexistent attempt", async () => {
    const res = await getPhoto(alice, MISSING_ID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Photo not found");
  });

  it("returns 404 when the file is gone from disk", async () => {
    const attempt = await createPhotoAttempt(alice, aliceRecipeId, { photo: b64(makeJpeg(10, 10)) });
    await rm(path.join(storageDir, "attempts", alice.id, `${attempt.id}.jpg`));

    const res = await getPhoto(alice, attempt.id);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Photo not found");
  });

  it("returns 404 when STORAGE_DIR is not set", async () => {
    const attempt = await createPhotoAttempt(alice, aliceRecipeId, { photo: b64(makeJpeg(10, 10)) });
    vi.stubEnv("STORAGE_DIR", "");
    const res = await getPhoto(alice, attempt.id);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Photo not found");
  });
});

describe("attempt enjoyment", () => {
  it.each(["LOVED", "FINE", "NOT_WORTH_IT", null])("POST stores enjoyment %j", async (enjoyment) => {
    const res = await postAttempt(alice, aliceRecipeId, { rating: 4, enjoyment });

    expect(res.status).toBe(201);
    expect(res.body.enjoyment).toBe(enjoyment);
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id: res.body.id } })).enjoyment).toBe(enjoyment);
  });

  it("POST leaves enjoyment null when omitted, and GET returns it", async () => {
    const res = await postAttempt(alice, aliceRecipeId, { rating: 4 });
    expect(res.body.enjoyment).toBeNull();

    const got = await request(app).get(`/attempts/${res.body.id}`).set(authed(alice));
    expect(got.body.enjoyment).toBeNull();
  });

  it("GET /attempts/:id and the recipe's list return the stored enjoyment", async () => {
    const recipeId = await createRecipe(alice);
    const id = await createAttempt(alice, recipeId, { enjoyment: "NOT_WORTH_IT" });

    const single = await request(app).get(`/attempts/${id}`).set(authed(alice));
    const list = await request(app).get(`/recipes/${recipeId}/attempts`).set(authed(alice));

    expect(single.body.enjoyment).toBe("NOT_WORTH_IT");
    expect(list.body[0]).toMatchObject({ id, enjoyment: "NOT_WORTH_IT" });
  });

  it.each(["LOVE", "loved", "", 2, true])("POST rejects enjoyment %j with 400 and creates nothing", async (enjoyment) => {
    const before = await attemptCount(aliceRecipeId);

    const res = await postAttempt(alice, aliceRecipeId, { enjoyment });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^enjoyment: /);
    expect(await attemptCount(aliceRecipeId)).toBe(before);
  });

  it("PATCH sets, keeps (when omitted) and clears enjoyment", async () => {
    const id = await createAttempt(alice, aliceRecipeId, {});

    const set = await patchAttempt(alice, id, { enjoyment: "LOVED" });
    expect(set.status).toBe(200);
    expect(set.body.enjoyment).toBe("LOVED");
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id } })).enjoyment).toBe("LOVED");

    const rated = await patchAttempt(alice, id, { rating: 5, fullness: "SATISFIED" });
    expect(rated.body).toMatchObject({ rating: 5, fullness: "SATISFIED", enjoyment: "LOVED" });

    const changed = await patchAttempt(alice, id, { enjoyment: "FINE" });
    expect(changed.body.enjoyment).toBe("FINE");

    const cleared = await patchAttempt(alice, id, { enjoyment: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ rating: 5, fullness: "SATISFIED", enjoyment: null });
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id } })).enjoyment).toBeNull();
  });

  it.each(["MEH", "fine", 0])("PATCH rejects enjoyment %j with 400 and changes nothing", async (enjoyment) => {
    const id = await createAttempt(alice, aliceRecipeId, { enjoyment: "FINE" });

    const res = await patchAttempt(alice, id, { enjoyment });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^enjoyment: /);
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id } })).enjoyment).toBe("FINE");
  });

  it("PATCH returns 404 for another user's attempt and leaves its enjoyment", async () => {
    const id = await createAttempt(bob, bobRecipeId, { enjoyment: "FINE" });

    const res = await patchAttempt(alice, id, { enjoyment: "LOVED" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Attempt not found");
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id } })).enjoyment).toBe("FINE");
  });

  it("PATCH rejects enjoyment without a session", async () => {
    const id = await createAttempt(alice, aliceRecipeId, { enjoyment: "FINE" });
    const res = await request(app).patch(`/attempts/${id}`).send({ enjoyment: "LOVED" });
    expect(res.status).toBe(401);
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id } })).enjoyment).toBe("FINE");
  });
});
