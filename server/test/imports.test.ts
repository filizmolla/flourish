import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { getStorageDir, readImageInfo, readJpegSize, readPngSize } from "../src/importPhotos.js";
import { parsedRecipeCount } from "../src/routes/imports.js";
import { LlmError, readRecipesFromPhotos, type ParsedRecipe } from "../src/llm.js";
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
  PNG_SIGNATURE,
  TestUser,
} from "./helpers.js";

// Never call a real model: only readRecipesFromPhotos is replaced, LlmError and
// getLlmModel stay real.
vi.mock("../src/llm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/llm.js")>()),
  readRecipesFromPhotos: vi.fn(),
}));

const readRecipesMock = vi.mocked(readRecipesFromPhotos);

const PNG_HEADER = Buffer.from([...PNG_SIGNATURE, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

function makeRecipe(overrides: Partial<ParsedRecipe> = {}): ParsedRecipe {
  return { title: "Lentil soup", source: "", ingredients: ["1 cup lentils", "1 onion"], steps: ["Chop.", "Boil."], ...overrides };
}

function parse(user: TestUser, body: object) {
  return request(app).post("/imports/parse").set(authed(user)).send(body);
}

async function importCount(user: TestUser) {
  return prisma.recipeImport.count({ where: { userId: user.id } });
}

describe("readJpegSize", () => {
  it("reads width and height from a baseline JPEG", () => {
    expect(readJpegSize(makeJpeg(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("reads a progressive (SOF2) frame header", () => {
    expect(readJpegSize(makeJpeg(1, 2, { sofMarker: 0xc2 }))).toEqual({ width: 1, height: 2 });
  });

  it("reads sizes above 255 in both bytes", () => {
    expect(readJpegSize(makeJpeg(4032, 3024))).toEqual({ width: 4032, height: 3024 });
  });

  it("skips a DHT segment, which shares the SOF marker range", () => {
    const jpeg = makeJpeg(10, 20);
    const dht = Buffer.from([0xff, 0xc4, 0x00, 0x04, 0x00, 0x00]);
    const withDht = Buffer.concat([jpeg.subarray(0, 2), dht, jpeg.subarray(2)]);
    expect(readJpegSize(withDht)).toEqual({ width: 10, height: 20 });
  });

  it("returns null for a PNG", () => {
    expect(readJpegSize(PNG_HEADER)).toBeNull();
  });

  it("returns null for random bytes", () => {
    expect(readJpegSize(Buffer.from("definitely not an image"))).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(readJpegSize(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for a JPEG cut off before the frame header", () => {
    expect(readJpegSize(makeJpeg(640, 480).subarray(0, 12))).toBeNull();
  });

  it("returns null for a JPEG cut off inside the frame header", () => {
    // SOI (2) + APP0 (18) + the first 6 bytes of SOF0: no width yet.
    expect(readJpegSize(makeJpeg(640, 480).subarray(0, 26))).toBeNull();
  });

  it("returns null for a zero-sized frame", () => {
    expect(readJpegSize(makeJpeg(0, 480))).toBeNull();
  });
});

describe("readPngSize", () => {
  it("reads width and height from the IHDR chunk", () => {
    expect(readPngSize(makePng(1080, 2400))).toEqual({ width: 1080, height: 2400 });
  });

  it("reads sizes that need all four bytes", () => {
    expect(readPngSize(makePng(70000, 1))).toEqual({ width: 70000, height: 1 });
  });

  it("reads exactly the first 24 bytes (signature, length, type, width, height)", () => {
    expect(readPngSize(makePng(3, 4).subarray(0, 24))).toEqual({ width: 3, height: 4 });
  });

  it("returns null for a wrong signature", () => {
    const png = makePng(10, 10);
    png[1] = 0x51; // "Q" instead of "P"
    expect(readPngSize(png)).toBeNull();
  });

  it("returns null when the first chunk isn't IHDR", () => {
    expect(readPngSize(makePng(10, 10, { firstChunk: "tEXt" }))).toBeNull();
  });

  it.each([
    ["the signature only", 8],
    ["the IHDR type", 16],
    ["the width", 20],
    ["one byte of the height", 23],
  ])("returns null when cut off after %s", (_label, length) => {
    expect(readPngSize(makePng(10, 10).subarray(0, length))).toBeNull();
  });

  it.each([
    ["width", 0, 10],
    ["height", 10, 0],
  ])("returns null for a zero %s", (_label, width, height) => {
    expect(readPngSize(makePng(width, height))).toBeNull();
  });

  it("returns null for a JPEG", () => {
    expect(readPngSize(makeJpeg(10, 10))).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(readPngSize(Buffer.alloc(0))).toBeNull();
  });
});

describe("readImageInfo", () => {
  it("reports a JPEG with its size", () => {
    expect(readImageInfo(makeJpeg(640, 480))).toEqual({ mimeType: "image/jpeg", width: 640, height: 480 });
  });

  it("reports a PNG with its size", () => {
    expect(readImageInfo(makePng(1080, 2400))).toEqual({ mimeType: "image/png", width: 1080, height: 2400 });
  });

  it.each([
    ["a GIF", GIF_HEADER],
    ["text", Buffer.from("hello world")],
    ["an empty buffer", Buffer.alloc(0)],
    ["a PNG cut off before the height", makePng(10, 10).subarray(0, 20)],
    ["a zero-sized JPEG", makeJpeg(0, 10)],
    ["a zero-sized PNG", makePng(10, 0)],
  ])("returns null for %s", (_label, data) => {
    expect(readImageInfo(data)).toBeNull();
  });
});

const storageDir = getStorageDir()!;
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
});

beforeEach(() => {
  readRecipesMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await deleteTestUsers(alice, bob);
  for (const user of [alice, bob]) {
    await rm(path.join(storageDir, "imports", user.id), { recursive: true, force: true });
  }
  await prisma.$disconnect();
});

describe("parsedRecipeCount", () => {
  it("counts the recipes of a DONE result", () => {
    expect(parsedRecipeCount({ recipes: [makeRecipe(), makeRecipe()] })).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(parsedRecipeCount({ recipes: [] })).toBe(0);
  });

  it.each([
    ["null (PENDING or FAILED)", null],
    ["an object without recipes", {}],
    ["recipes that isn't an array", { recipes: "nope" }],
    ["a bare array", [makeRecipe()]],
  ])("returns 0 for %s", (_label, result) => {
    expect(parsedRecipeCount(result)).toBe(0);
  });
});

describe("POST /imports/parse", () => {
  describe("auth", () => {
    it("rejects requests without a session", async () => {
      const res = await request(app).post("/imports/parse").send({ images: [b64(makeJpeg(10, 10))] });
      expect(res.status).toBe(401);
      expect(readRecipesMock).not.toHaveBeenCalled();
    });

    it("rejects an invalid bearer token", async () => {
      const res = await request(app)
        .post("/imports/parse")
        .set("Authorization", "Bearer not-a-token")
        .send({ images: [b64(makeJpeg(10, 10))] });
      expect(res.status).toBe(401);
    });
  });

  describe("validation", () => {
    const jpeg = b64(makeJpeg(10, 10));

    it.each([
      ["missing", {}, "images must be a non-empty array"],
      ["not an array", { images: jpeg }, "images must be a non-empty array"],
      ["null", { images: null }, "images must be a non-empty array"],
      ["empty", { images: [] }, "images must be a non-empty array"],
      ["6 images", { images: Array(6).fill(jpeg) }, "At most 5 images are allowed"],
      ["a non-string item", { images: [jpeg, 42] }, "images[1] must be a base64 string"],
      ["an empty string", { images: [""] }, "images[0] must be a base64 string"],
      ["a non-base64 string", { images: ["not base64!"] }, "images[0] must be a base64 string"],
      ["a data URL", { images: [`data:image/jpeg;base64,${jpeg}`] }, "images[0] must be a base64 string"],
      ["base64 of a GIF", { images: [jpeg, b64(GIF_HEADER)] }, "images[1] is not a JPEG or PNG"],
      ["base64 of a PNG cut off before its size", { images: [b64(PNG_HEADER)] }, "images[0] is not a JPEG or PNG"],
      ["base64 of a zero-sized PNG", { images: [jpeg, jpeg, b64(makePng(0, 10))] }, "images[2] is not a JPEG or PNG"],
      ["base64 of text", { images: [b64(Buffer.from("hello world"))] }, "images[0] is not a JPEG or PNG"],
    ])("rejects images %s with 400", async (_label, body, error) => {
      const before = await importCount(alice);
      const res = await parse(alice, body);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error });
      expect(readRecipesMock).not.toHaveBeenCalled();
      expect(await importCount(alice)).toBe(before);
    });

    it("accepts exactly 5 images", async () => {
      readRecipesMock.mockResolvedValue([makeRecipe()]);
      const res = await parse(alice, { images: Array(5).fill(jpeg) });
      expect(res.status).toBe(200);
      expect(readRecipesMock).toHaveBeenCalledTimes(1);
    });

    it("returns 413 with a JSON error for a body over 10 MB", async () => {
      const before = await importCount(alice);
      const res = await parse(alice, { images: ["A".repeat(11 * 1024 * 1024)] });

      expect(res.status).toBe(413);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: "The photos are too large" });
      expect(readRecipesMock).not.toHaveBeenCalled();
      expect(await importCount(alice)).toBe(before);
    });
  });

  describe("when the model finds recipes", () => {
    it("returns one recipe with steps joined into instructions and records a DONE import", async () => {
      vi.stubEnv("LLM_MODEL", "test-model");
      readRecipesMock.mockResolvedValue([makeRecipe()]);

      const res = await parse(alice, { images: [b64(makeJpeg(10, 10))] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        importId: expect.any(String),
        recipes: [{ title: "Lentil soup", source: "", ingredients: ["1 cup lentils", "1 onion"], instructions: "Chop.\nBoil." }],
      });

      const row = await prisma.recipeImport.findUniqueOrThrow({ where: { id: res.body.importId } });
      expect(row).toMatchObject({
        userId: alice.id,
        status: "DONE",
        photoCount: 1,
        model: "test-model",
        error: null,
        reviewedCount: 0,
        closedAt: null,
        result: { recipes: [makeRecipe()] },
      });
      expect(typeof row.durationMs).toBe("number");
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns several recipes in the model's order", async () => {
      const recipes = [
        makeRecipe({ title: "Dough", source: "@doughlab", ingredients: ["flour"], steps: ["Knead."] }),
        makeRecipe({ title: "Sauce", ingredients: ["tomatoes", "salt"], steps: ["Simmer.", "Season.", "Blend."] }),
      ];
      readRecipesMock.mockResolvedValue(recipes);

      const res = await parse(alice, { images: [b64(makeJpeg(10, 10)), b64(makeJpeg(20, 20))] });

      expect(res.status).toBe(200);
      expect(res.body.recipes).toEqual([
        { title: "Dough", source: "@doughlab", ingredients: ["flour"], instructions: "Knead." },
        { title: "Sauce", source: "", ingredients: ["tomatoes", "salt"], instructions: "Simmer.\nSeason.\nBlend." },
      ]);

      const row = await prisma.recipeImport.findUniqueOrThrow({ where: { id: res.body.importId } });
      expect(row).toMatchObject({ status: "DONE", photoCount: 2, model: "", closedAt: null, result: { recipes } });
    });

    it("passes the source through and keeps it in the stored result, with section headings as lines", async () => {
      const recipe = makeRecipe({
        source: "@someone",
        ingredients: ["# For the cake", "2 cups flour", "# For the cream", "200 ml cream"],
        steps: ["# For the cake", "Bake 30 min.", "# For the cream", "Whip."],
      });
      readRecipesMock.mockResolvedValue([recipe]);

      const res = await parse(alice, { images: [b64(makeJpeg(10, 10))] });

      expect(res.status).toBe(200);
      expect(res.body.recipes).toEqual([
        {
          title: "Lentil soup",
          source: "@someone",
          ingredients: ["# For the cake", "2 cups flour", "# For the cream", "200 ml cream"],
          instructions: "# For the cake\nBake 30 min.\n# For the cream\nWhip.",
        },
      ]);

      const row = await prisma.recipeImport.findUniqueOrThrow({ where: { id: res.body.importId } });
      expect(row.result).toEqual({ recipes: [recipe] });
    });

    it("returns an empty list and closes the import as NO_RECIPE when nothing is found", async () => {
      readRecipesMock.mockResolvedValue([]);

      const res = await parse(alice, { images: [b64(makeJpeg(10, 10))] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ importId: expect.any(String), recipes: [] });

      const row = await prisma.recipeImport.findUniqueOrThrow({ where: { id: res.body.importId } });
      expect(row).toMatchObject({ status: "NO_RECIPE", photoCount: 1, error: null, result: { recipes: [] } });
      expect(row.closedAt).toBeInstanceOf(Date);
      expect(typeof row.durationMs).toBe("number");
    });
  });

  describe("when the model fails", () => {
    it.each([
      ["timeout", "The model didn't answer in time"],
      ["invalid_reply", "Reply isn't valid JSON"],
    ] as const)("returns 502 for %s and records a FAILED import", async (reason, message) => {
      readRecipesMock.mockRejectedValue(new LlmError(reason, message));

      const res = await parse(alice, { images: [b64(makeJpeg(10, 10))] });

      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: "Couldn't read the photos", importId: expect.any(String) });
      expect(res.body).not.toHaveProperty("recipes");

      const row = await prisma.recipeImport.findUniqueOrThrow({ where: { id: res.body.importId } });
      expect(row).toMatchObject({ userId: alice.id, status: "FAILED", photoCount: 1, result: null });
      expect(row.error).toBe(`${reason}: ${message}`);
      expect(row.closedAt).toBeInstanceOf(Date);
      expect(typeof row.durationMs).toBe("number");
    });

    it("caps a very long error message at 1000 characters", async () => {
      readRecipesMock.mockRejectedValue(new LlmError("http", "x".repeat(5000)));

      const res = await parse(alice, { images: [b64(makeJpeg(10, 10))] });

      expect(res.status).toBe(502);
      const row = await prisma.recipeImport.findUniqueOrThrow({ where: { id: res.body.importId } });
      expect(row.error).toHaveLength(1000);
      expect(row.error!.startsWith("http: xxx")).toBe(true);
    });
  });

  describe("photos", () => {
    const photos = [makeJpeg(640, 480, { extra: 1 }), makeJpeg(300, 1200, { extra: 2 }), makeJpeg(1, 1, { extra: 3 })];
    const images = photos.map(b64);

    async function expectPhotosKept(importId: string) {
      const rows = await prisma.importPhoto.findMany({ where: { importId }, orderBy: { position: "asc" } });
      expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);

      for (const [position, photo] of photos.entries()) {
        const size = readJpegSize(photo)!;
        expect(rows[position]).toMatchObject({
          path: `imports/${alice.id}/${importId}/${position}.jpg`,
          mimeType: "image/jpeg",
          bytes: photo.length,
          width: size.width,
          height: size.height,
        });
        const onDisk = await readFile(path.join(storageDir, rows[position].path));
        expect(onDisk.equals(photo)).toBe(true);
      }
    }

    it("keeps one row and one file per photo, in the order sent", async () => {
      readRecipesMock.mockResolvedValue([makeRecipe()]);

      const res = await parse(alice, { images });

      expect(res.status).toBe(200);
      expect(readRecipesMock).toHaveBeenCalledTimes(1);
      expect(readRecipesMock.mock.calls[0][0]).toEqual(
        images.map((base64) => ({ base64, mimeType: "image/jpeg" })),
      );
      await expectPhotosKept(res.body.importId);
    });

    it("keeps a PNG as .png and a JPEG as .jpg, each with its own mimeType, in the order sent", async () => {
      readRecipesMock.mockResolvedValue([makeRecipe()]);
      const mixed = [makePng(1080, 2400, { extra: 21 }), makeJpeg(640, 480, { extra: 22 }), makePng(5, 7, { extra: 23 })];
      const mixedImages = mixed.map(b64);

      const res = await parse(alice, { images: mixedImages });

      expect(res.status).toBe(200);
      const importId: string = res.body.importId;
      expect(readRecipesMock.mock.calls[0][0]).toEqual([
        { base64: mixedImages[0], mimeType: "image/png" },
        { base64: mixedImages[1], mimeType: "image/jpeg" },
        { base64: mixedImages[2], mimeType: "image/png" },
      ]);

      const rows = await prisma.importPhoto.findMany({ where: { importId }, orderBy: { position: "asc" } });
      expect(rows.map(({ position, path: p, mimeType, bytes, width, height }) => ({ position, path: p, mimeType, bytes, width, height }))).toEqual([
        { position: 0, path: `imports/${alice.id}/${importId}/0.png`, mimeType: "image/png", bytes: mixed[0].length, width: 1080, height: 2400 },
        { position: 1, path: `imports/${alice.id}/${importId}/1.jpg`, mimeType: "image/jpeg", bytes: mixed[1].length, width: 640, height: 480 },
        { position: 2, path: `imports/${alice.id}/${importId}/2.png`, mimeType: "image/png", bytes: mixed[2].length, width: 5, height: 7 },
      ]);
      for (const [position, photo] of mixed.entries()) {
        const onDisk = await readFile(path.join(storageDir, rows[position].path));
        expect(onDisk.equals(photo)).toBe(true);
      }
    });

    it("keeps the photos when the model fails", async () => {
      readRecipesMock.mockRejectedValue(new LlmError("timeout", "too slow"));

      const res = await parse(alice, { images });

      expect(res.status).toBe(502);
      await expectPhotosKept(res.body.importId);
    });

    it("keeps the photos when no recipe is found", async () => {
      readRecipesMock.mockResolvedValue([]);

      const res = await parse(alice, { images });

      expect(res.status).toBe(200);
      await expectPhotosKept(res.body.importId);
    });
  });

  describe("user deletion", () => {
    it("deletes the user's imports and their photo rows", async () => {
      const carol = await createTestUser("Carol");
      try {
        readRecipesMock.mockResolvedValue([makeRecipe()]);
        const res = await parse(carol, { images: [b64(makeJpeg(10, 10))] });
        expect(res.status).toBe(200);
        const importId: string = res.body.importId;
        expect(await prisma.importPhoto.count({ where: { importId } })).toBe(1);

        await deleteTestUsers(carol);

        expect(await prisma.recipeImport.count({ where: { userId: carol.id } })).toBe(0);
        expect(await prisma.importPhoto.count({ where: { importId } })).toBe(0);
      } finally {
        await deleteTestUsers(carol);
        await rm(path.join(storageDir, "imports", carol.id), { recursive: true, force: true });
      }
    });
  });
});

describe("GET /imports/:id/photos/:position", () => {
  const photos = [makeJpeg(640, 480, { extra: 11 }), makeJpeg(300, 1200, { extra: 12 }), makeJpeg(1, 1, { extra: 13 })];

  // Creates an import through POST /imports/parse with the mocked model.
  async function createImport(user: TestUser, images: Buffer[], { fail = false } = {}): Promise<string> {
    if (fail) readRecipesMock.mockRejectedValueOnce(new LlmError("timeout", "too slow"));
    else readRecipesMock.mockResolvedValueOnce([makeRecipe()]);
    const res = await parse(user, { images: images.map(b64) });
    if (res.status !== (fail ? 502 : 200)) {
      throw new Error(`Import failed (${res.status}): ${JSON.stringify(res.body)}`);
    }
    return res.body.importId;
  }

  function getPhoto(user: TestUser | null, importId: string, position: string | number) {
    const req = request(app).get(`/imports/${importId}/photos/${position}`).responseType("blob");
    return user ? req.set(authed(user)) : req;
  }

  let importId: string;
  let onePhotoImportId: string;

  beforeAll(async () => {
    importId = await createImport(alice, photos);
    onePhotoImportId = await createImport(alice, [photos[0]]);
  });

  it.each([0, 1, 2])("serves the owner the photo at position %i", async (position) => {
    const res = await getPhoto(alice, importId, position);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toBe("private, no-cache");
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).equals(photos[position])).toBe(true);
  });

  it("serves a PNG with content-type image/png, next to a JPEG of the same import", async () => {
    const png = makePng(1080, 2400, { extra: 14 });
    const mixedId = await createImport(alice, [png, photos[0]]);

    const pngRes = await getPhoto(alice, mixedId, 0);
    expect(pngRes.status).toBe(200);
    expect(pngRes.headers["content-type"]).toBe("image/png");
    expect((pngRes.body as Buffer).equals(png)).toBe(true);

    const jpegRes = await getPhoto(alice, mixedId, 1);
    expect(jpegRes.status).toBe(200);
    expect(jpegRes.headers["content-type"]).toBe("image/jpeg");
  });

  it("serves the photos of a FAILED import", async () => {
    const failedId = await createImport(alice, photos.slice(0, 2), { fail: true });
    const row = await prisma.recipeImport.findUniqueOrThrow({ where: { id: failedId } });
    expect(row.status).toBe("FAILED");

    for (const position of [0, 1]) {
      const res = await getPhoto(alice, failedId, position);
      expect(res.status).toBe(200);
      expect((res.body as Buffer).equals(photos[position])).toBe(true);
    }
  });

  it("rejects requests without a session", async () => {
    const res = await getPhoto(null, importId, 0);
    expect(res.status).toBe(401);
  });

  it("returns 404 for another user's import, with the same body as a missing one", async () => {
    const res = await request(app).get(`/imports/${importId}/photos/0`).set(authed(bob));
    const missing = await request(app).get("/imports/no-such-import/photos/0").set(authed(bob));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Photo not found" });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(res.body);
  });

  it("returns 404 for an unknown import id", async () => {
    const res = await request(app).get("/imports/no-such-import/photos/0").set(authed(alice));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Photo not found" });
  });

  it("returns 404 for a position with no photo", async () => {
    const res = await request(app).get(`/imports/${onePhotoImportId}/photos/2`).set(authed(alice));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Photo not found" });
  });

  it.each(["5", "6", "-1", "abc", "1.5", "99999999999", "1e1", " 1"])(
    "returns 404 (never 500) for position %j",
    async (position) => {
      const res = await request(app)
        .get(`/imports/${importId}/photos/${encodeURIComponent(position)}`)
        .set(authed(alice));
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Photo not found" });
    },
  );

  it("returns 404 when the row exists but the file is gone", async () => {
    const id = await createImport(alice, [photos[0]]);
    const row = await prisma.importPhoto.findFirstOrThrow({ where: { importId: id, position: 0 } });
    await rm(path.join(storageDir, row.path));

    const res = await request(app).get(`/imports/${id}/photos/0`).set(authed(alice));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Photo not found" });
  });
});

const threeRecipes = [makeRecipe({ title: "Dough" }), makeRecipe({ title: "Sauce" }), makeRecipe({ title: "Topping" })];

// An import made through POST /imports/parse; the mock decides the outcome.
async function makeImport(user: TestUser, outcome: ParsedRecipe[] | LlmError = threeRecipes): Promise<string> {
  if (outcome instanceof LlmError) readRecipesMock.mockRejectedValueOnce(outcome);
  else readRecipesMock.mockResolvedValueOnce(outcome);
  const res = await parse(user, { images: [b64(makeJpeg(10, 10))] });
  if (!res.body.importId) throw new Error(`Import failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.importId;
}

// Saves parsed recipe importIndex of an import through POST /recipes.
function saveRecipe(user: TestUser, body: object) {
  return request(app)
    .post("/recipes")
    .set(authed(user))
    .send({ title: "Imported soup", ingredients: ["1 cup lentils"], instructions: "Boil.", ...body });
}

function getImport(importId: string) {
  return prisma.recipeImport.findUniqueOrThrow({ where: { id: importId } });
}

describe("POST /recipes with importId and importIndex", () => {
  const ALREADY_SAVED = "This recipe from the import was already saved";

  it("saves a recipe linked to the import and moves reviewedCount to importIndex + 1", async () => {
    const importId = await makeImport(alice);

    const res = await saveRecipe(alice, { importId, importIndex: 0 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Imported soup", importId, importIndex: 0 });
    const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(recipe).toMatchObject({ userId: alice.id, importId, importIndex: 0 });
    const row = await getImport(importId);
    expect(row.reviewedCount).toBe(1);
    expect(row.closedAt).toBeNull();
  });

  it("counts up 1, 2, 3 when saved in order and closes the import on the last one", async () => {
    const importId = await makeImport(alice);

    for (const index of [0, 1]) {
      expect((await saveRecipe(alice, { importId, importIndex: index })).status).toBe(201);
      const row = await getImport(importId);
      expect(row.reviewedCount).toBe(index + 1);
      expect(row.closedAt).toBeNull();
    }

    expect((await saveRecipe(alice, { importId, importIndex: 2 })).status).toBe(201);
    const row = await getImport(importId);
    expect(row.reviewedCount).toBe(3);
    expect(row.closedAt).toBeInstanceOf(Date);
  });

  it("closes at once when the last recipe is saved first, and never counts down", async () => {
    const importId = await makeImport(alice);

    expect((await saveRecipe(alice, { importId, importIndex: 2 })).status).toBe(201);
    const closed = await getImport(importId);
    expect(closed.reviewedCount).toBe(3);
    expect(closed.closedAt).toBeInstanceOf(Date);

    expect((await saveRecipe(alice, { importId, importIndex: 0 })).status).toBe(201);
    const after = await getImport(importId);
    expect(after.reviewedCount).toBe(3);
    expect(after.closedAt).toEqual(closed.closedAt);
  });

  it("saves a plain recipe when both are null, like omitting them", async () => {
    const withNulls = await saveRecipe(alice, { importId: null, importIndex: null });
    const omitted = await saveRecipe(alice, {});

    for (const res of [withNulls, omitted]) {
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ importId: null, importIndex: null });
    }
  });

  describe("validation", () => {
    const TOGETHER = "importId and importIndex must be sent together";
    const BAD_ID = "importId must be a string or null";
    const BAD_INDEX = "importIndex must be a non-negative integer or null";
    let importId: string;

    beforeAll(async () => {
      importId = await makeImport(alice);
    });

    it.each([
      ["importId without importIndex", () => ({ importId }), TOGETHER],
      ["importIndex without importId", () => ({ importIndex: 0 }), TOGETHER],
      ["importId null with an importIndex", () => ({ importId: null, importIndex: 0 }), TOGETHER],
      ["importIndex null with an importId", () => ({ importId, importIndex: null }), TOGETHER],
      ["importId a number", () => ({ importId: 42, importIndex: 0 }), BAD_ID],
      ["importId empty", () => ({ importId: "", importIndex: 0 }), BAD_ID],
      ["importIndex negative", () => ({ importId, importIndex: -1 }), BAD_INDEX],
      ["importIndex 1.5", () => ({ importId, importIndex: 1.5 }), BAD_INDEX],
      ["importIndex a string", () => ({ importId, importIndex: "0" }), BAD_INDEX],
      ["importIndex equal to the parsed count", () => ({ importId, importIndex: 3 }), "importIndex must be below 3"],
      ["importIndex above the parsed count", () => ({ importId, importIndex: 10 }), "importIndex must be below 3"],
    ])("rejects %s with 400", async (_label, body, error) => {
      const recipesBefore = await prisma.recipe.count({ where: { userId: alice.id } });

      const res = await saveRecipe(alice, body());

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error });
      expect(await prisma.recipe.count({ where: { userId: alice.id } })).toBe(recipesBefore);
      expect((await getImport(importId)).reviewedCount).toBe(0);
    });

    it("rejects any index on a NO_RECIPE import", async () => {
      const emptyId = await makeImport(alice, []);
      expect((await getImport(emptyId)).status).toBe("NO_RECIPE");

      const res = await saveRecipe(alice, { importId: emptyId, importIndex: 0 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "This import has no recipes to save" });
    });

    it("rejects any index on a FAILED import", async () => {
      const failedId = await makeImport(alice, new LlmError("timeout", "too slow"));
      expect((await getImport(failedId)).status).toBe("FAILED");

      const res = await saveRecipe(alice, { importId: failedId, importIndex: 0 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "This import has no recipes to save" });
    });

    it("rejects a forkable attempt together with an import", async () => {
      const recipeId = await createRecipe(alice, { title: "Shakshuka", ingredients: ["4 eggs"] });
      const attemptId = await createAttempt(alice, recipeId, {
        ingredients: [{ text: "4 eggs" }, { text: "2 chillies" }],
      });
      const forkOnly = { forkedFromAttemptId: attemptId };

      const res = await saveRecipe(alice, { ...forkOnly, importId, importIndex: 0 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "A recipe can't come from both an attempt and an import" });
      expect((await getImport(importId)).reviewedCount).toBe(0);
      expect(await prisma.recipe.count({ where: { forkedFromAttemptId: attemptId } })).toBe(0);

      // The attempt is forkable on its own, so only the import made it a 400.
      expect((await saveRecipe(alice, forkOnly)).status).toBe(201);
    });

    it("doesn't move reviewedCount when the title is invalid", async () => {
      const res = await saveRecipe(alice, { title: "   ", importId, importIndex: 1 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "title is required" });
      expect((await getImport(importId)).reviewedCount).toBe(0);
    });
  });

  it("returns 404 for another user's import", async () => {
    const importId = await makeImport(alice);

    const res = await saveRecipe(bob, { importId, importIndex: 0 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Import not found" });
    expect((await getImport(importId)).reviewedCount).toBe(0);
    expect(await prisma.recipe.count({ where: { importId } })).toBe(0);
  });

  it("returns 404 for an unknown import id", async () => {
    const res = await saveRecipe(alice, { importId: "cl_does_not_exist_000000", importIndex: 0 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Import not found" });
  });

  it("returns 409 for the same recipe saved twice and changes nothing", async () => {
    const importId = await makeImport(alice);
    const first = await saveRecipe(alice, { importId, importIndex: 0 });
    expect(first.status).toBe(201);

    const second = await saveRecipe(alice, { title: "Again", importId, importIndex: 0 });

    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: ALREADY_SAVED });
    expect((await getImport(importId)).reviewedCount).toBe(1);
    const saved = await prisma.recipe.findMany({ where: { importId } });
    expect(saved.map((r) => r.id)).toEqual([first.body.id]);
  });

  it("lets only one of two concurrent identical saves through", async () => {
    const importId = await makeImport(alice);

    const results = await Promise.all([
      saveRecipe(alice, { importId, importIndex: 1 }),
      saveRecipe(alice, { importId, importIndex: 1 }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body).toEqual({ error: ALREADY_SAVED });
    expect(await prisma.recipe.count({ where: { importId } })).toBe(1);
    const row = await getImport(importId);
    expect(row.reviewedCount).toBe(2);
    expect(row.closedAt).toBeNull();
  });

  it("keeps the import when the saved recipe is deleted", async () => {
    const importId = await makeImport(alice);
    const saved = await saveRecipe(alice, { importId, importIndex: 1 });
    expect(saved.status).toBe(201);

    const del = await request(app).delete(`/recipes/${saved.body.id}`).set(authed(alice));

    expect(del.status).toBe(204);
    const row = await getImport(importId);
    expect(row.reviewedCount).toBe(2);
    expect(row.closedAt).toBeNull();
  });

  it("deletes the import and its recipes with the user", async () => {
    const carol = await createTestUser("Carol");
    try {
      const importId = await makeImport(carol);
      const saved = await saveRecipe(carol, { importId, importIndex: 0 });
      expect(saved.status).toBe(201);

      await deleteTestUsers(carol);

      expect(await prisma.recipeImport.count({ where: { id: importId } })).toBe(0);
      expect(await prisma.recipe.count({ where: { id: saved.body.id } })).toBe(0);
    } finally {
      await deleteTestUsers(carol);
      await rm(path.join(storageDir, "imports", carol.id), { recursive: true, force: true });
    }
  });
});

describe("PATCH /imports/:id", () => {
  function patchImport(user: TestUser, importId: string, body?: object) {
    const req = request(app).patch(`/imports/${importId}`).set(authed(user));
    return body === undefined ? req : req.send(body);
  }

  // The row's review fields, to check a 4xx changed nothing.
  async function reviewState(importId: string) {
    const { reviewedCount, closedAt, status, updatedAt } = await getImport(importId);
    return { reviewedCount, closedAt, status, updatedAt };
  }

  describe("skipping", () => {
    it("moves reviewedCount up without closing, then closes at the parsed count", async () => {
      const importId = await makeImport(alice);

      const skip = await patchImport(alice, importId, { reviewedCount: 1 });
      expect(skip.status).toBe(200);
      expect(skip.body).toEqual({ id: importId, status: "DONE", reviewedCount: 1, closedAt: null });

      const again = await patchImport(alice, importId, { reviewedCount: 1 });
      expect(again.status).toBe(200);
      expect(again.body).toEqual(skip.body);

      const last = await patchImport(alice, importId, { reviewedCount: 3 });
      expect(last.status).toBe(200);
      expect(last.body).toMatchObject({ id: importId, reviewedCount: 3, closedAt: expect.any(String) });

      const row = await getImport(importId);
      expect(row.reviewedCount).toBe(3);
      expect(row.closedAt?.toISOString()).toBe(last.body.closedAt);
    });

    it("accepts the current count after a save but not a lower one", async () => {
      const importId = await makeImport(alice);
      // Saving index 0 makes the count 1.
      expect((await saveRecipe(alice, { importId, importIndex: 0 })).status).toBe(201);

      const same = await patchImport(alice, importId, { reviewedCount: 1 });
      expect(same.status).toBe(200);
      expect(same.body).toMatchObject({ reviewedCount: 1, closedAt: null });

      const below = await patchImport(alice, importId, { reviewedCount: 0 });
      expect(below.status).toBe(400);
      expect(below.body).toEqual({ error: "reviewedCount can't go down from 1" });
      expect((await getImport(importId)).reviewedCount).toBe(1);
    });
  });

  describe("stopping", () => {
    it("closes without moving reviewedCount", async () => {
      const importId = await makeImport(alice);
      await patchImport(alice, importId, { reviewedCount: 1 });

      const res = await patchImport(alice, importId, { closed: true });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: importId, status: "DONE", reviewedCount: 1, closedAt: expect.any(String) });
      const row = await getImport(importId);
      expect(row.reviewedCount).toBe(1);
      expect(row.closedAt).toBeInstanceOf(Date);
    });

    it("moves the count and closes when both are sent", async () => {
      const importId = await makeImport(alice);

      const res = await patchImport(alice, importId, { reviewedCount: 2, closed: true });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ reviewedCount: 2, closedAt: expect.any(String) });
    });

    it("keeps the first closedAt when closed twice", async () => {
      const importId = await makeImport(alice);
      const first = await patchImport(alice, importId, { closed: true });
      expect(first.status).toBe(200);

      const second = await patchImport(alice, importId, { closed: true });

      expect(second.status).toBe(200);
      expect(second.body.closedAt).toBe(first.body.closedAt);
    });
  });

  describe("errors change nothing", () => {
    let importId: string;

    beforeAll(async () => {
      importId = await makeImport(alice);
      // Count 2, so "lower than the current count" can be checked.
      expect((await saveRecipe(alice, { importId, importIndex: 1 })).status).toBe(201);
    });

    const NOT_INT = "reviewedCount must be a non-negative integer";
    const ONLY_TRUE = "closed can only be true";
    const NOTHING = "Send reviewedCount or closed";

    it.each([
      ["an empty body", {}, NOTHING],
      ["only unknown fields", { status: "DONE" }, NOTHING],
      ["reviewedCount lower than the current count", { reviewedCount: 1 }, "reviewedCount can't go down from 2"],
      ["reviewedCount 0 after a save", { reviewedCount: 0 }, "reviewedCount can't go down from 2"],
      ["reviewedCount above the parsed count", { reviewedCount: 4 }, "reviewedCount must be at most 3"],
      ["reviewedCount 1.5", { reviewedCount: 1.5 }, NOT_INT],
      ["reviewedCount negative", { reviewedCount: -1 }, NOT_INT],
      ["reviewedCount a string", { reviewedCount: "3" }, NOT_INT],
      ["reviewedCount null", { reviewedCount: null }, NOT_INT],
      ["closed false", { closed: false }, ONLY_TRUE],
      ["closed the string true", { closed: "true" }, ONLY_TRUE],
      ["a valid count with closed false", { reviewedCount: 3, closed: false }, ONLY_TRUE],
    ])("rejects %s with 400", async (_label, body, error) => {
      const before = await reviewState(importId);

      const res = await patchImport(alice, importId, body);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error });
      expect(await reviewState(importId)).toEqual(before);
    });

    it("rejects a request with no body", async () => {
      const before = await reviewState(importId);

      const res = await patchImport(alice, importId);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: NOTHING });
      expect(await reviewState(importId)).toEqual(before);
    });

    it("returns 404 for another user's import", async () => {
      const before = await reviewState(importId);

      const res = await patchImport(bob, importId, { closed: true });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Import not found" });
      expect(await reviewState(importId)).toEqual(before);
    });

    it("returns 404 for an unknown import id", async () => {
      const res = await patchImport(alice, "cl_does_not_exist_000000", { closed: true });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Import not found" });
    });

    it("rejects requests without a session", async () => {
      const before = await reviewState(importId);

      const res = await request(app).patch(`/imports/${importId}`).send({ closed: true });

      expect(res.status).toBe(401);
      expect(await reviewState(importId)).toEqual(before);
    });
  });

  it("works together with saves: save 0, skip to 2, save 2, then can't go down", async () => {
    const importId = await makeImport(alice);

    expect((await saveRecipe(alice, { importId, importIndex: 0 })).status).toBe(201);
    const skip = await patchImport(alice, importId, { reviewedCount: 2 });
    expect(skip.body).toMatchObject({ reviewedCount: 2, closedAt: null });
    expect((await saveRecipe(alice, { importId, importIndex: 2 })).status).toBe(201);

    const row = await getImport(importId);
    expect(row.reviewedCount).toBe(3);
    expect(row.closedAt).toBeInstanceOf(Date);

    const back = await patchImport(alice, importId, { reviewedCount: 2 });
    expect(back.status).toBe(400);
    expect(back.body).toEqual({ error: "reviewedCount can't go down from 3" });
  });

  it("accepts 0 on a NO_RECIPE import without touching closedAt, and rejects 1", async () => {
    const importId = await makeImport(alice, []);
    const before = await getImport(importId);
    expect(before.closedAt).toBeInstanceOf(Date);

    const zero = await patchImport(alice, importId, { reviewedCount: 0 });
    expect(zero.status).toBe(200);
    expect(zero.body).toEqual({
      id: importId,
      status: "NO_RECIPE",
      reviewedCount: 0,
      closedAt: before.closedAt!.toISOString(),
    });

    const one = await patchImport(alice, importId, { reviewedCount: 1 });
    expect(one.status).toBe(400);
    expect(one.body).toEqual({ error: "reviewedCount must be at most 0" });
    expect((await getImport(importId)).closedAt).toEqual(before.closedAt);
  });

  describe("on an import whose photos are still being read", () => {
    let pendingId: string;

    beforeAll(async () => {
      // What POST /imports/parse leaves while the model runs: PENDING, no result.
      const row = await prisma.recipeImport.create({ data: { userId: alice.id, photoCount: 1, model: "" } });
      expect(row).toMatchObject({ status: "PENDING", result: null, closedAt: null });
      pendingId = row.id;
    });

    it.each([
      ["reviewedCount 0", { reviewedCount: 0 }],
      ["closed", { closed: true }],
      ["both", { reviewedCount: 0, closed: true }],
    ])("returns 409 for %s and changes nothing", async (_label, body) => {
      const before = await reviewState(pendingId);

      const res = await patchImport(alice, pendingId, body);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "The photos are still being read" });
      expect(await reviewState(pendingId)).toEqual(before);
    });

    it("still returns 404 for another user", async () => {
      const res = await patchImport(bob, pendingId, { closed: true });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Import not found" });
    });
  });
});

describe("malformed JSON bodies on /imports", () => {
  const MALFORMED = '{"reviewedCount":';

  it("returns a JSON 400 for PATCH /imports/:id and changes nothing", async () => {
    const importId = await makeImport(alice);
    const before = await getImport(importId);

    const res = await request(app)
      .patch(`/imports/${importId}`)
      .set(authed(alice))
      .set("Content-Type", "application/json")
      .send(MALFORMED);

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: "The request body is not valid JSON" });
    expect(await getImport(importId)).toEqual(before);
  });

  it("returns a JSON 400 for POST /imports/parse and creates no import", async () => {
    const countBefore = await prisma.recipeImport.count({ where: { userId: alice.id } });

    const res = await request(app)
      .post("/imports/parse")
      .set(authed(alice))
      .set("Content-Type", "application/json")
      .send('{"images": ["abc"');

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: "The request body is not valid JSON" });
    expect(readRecipesMock).not.toHaveBeenCalled();
    expect(await prisma.recipeImport.count({ where: { userId: alice.id } })).toBe(countBefore);
  });
});
