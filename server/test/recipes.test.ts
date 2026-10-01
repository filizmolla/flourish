import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { authed, createTestUser, deleteTestUsers, TestUser } from "./helpers.js";

const validRecipe = {
  title: "Test Pancakes",
  ingredients: ["1 cup flour", "1 egg"],
  instructions: "Mix and cook.",
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

describe("auth guard", () => {
  it("rejects requests without a session", async () => {
    const res = await request(app).get("/recipes");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await request(app).get("/recipes").set("Authorization", "Bearer not-a-token");
    expect(res.status).toBe(401);
  });
});

describe("POST /recipes", () => {
  it("creates a recipe with the optional detail fields", async () => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, story: "Once upon a time…", prepMinutes: 5, servings: 2 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "Test Pancakes",
      story: "Once upon a time…",
      prepMinutes: 5,
      cookMinutes: null,
      servings: 2,
    });
  });

  it("trims the title", async () => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, title: "  Padded  " });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Padded");
  });

  it.each([
    ["a blank title", { title: "   " }, "title is required"],
    ["non-string ingredients", { ingredients: [1, 2] }, "ingredients must be an array of strings"],
    ["missing instructions", { instructions: undefined }, "instructions is required"],
    ["a non-string story", { story: 42 }, "story must be a string or null"],
    ["negative minutes", { prepMinutes: -1 }, "prepMinutes must be a non-negative integer or null"],
    ["fractional servings", { servings: 1.5 }, "servings must be a non-negative integer or null"],
  ])("rejects %s", async (_label, override, message) => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, ...override });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });
});

describe("ownership", () => {
  let aliceRecipeId: string;

  beforeAll(async () => {
    const res = await request(app).post("/recipes").set(authed(alice)).send(validRecipe);
    aliceRecipeId = res.body.id;
  });

  it("lists only the caller's recipes", async () => {
    const res = await request(app).get("/recipes").set(authed(bob));
    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: string }) => r.id)).not.toContain(aliceRecipeId);
  });

  it.each([
    ["read", "get"],
    ["update", "patch"],
    ["delete", "delete"],
  ] as const)("does not let another user %s it", async (_label, method) => {
    const res = await request(app)[method](`/recipes/${aliceRecipeId}`)
      .set(authed(bob))
      .send({ title: "Hijacked" });

    expect(res.status).toBe(404);
  });

  it("still has the recipe unchanged afterwards", async () => {
    const res = await request(app).get(`/recipes/${aliceRecipeId}`).set(authed(alice));
    expect(res.status).toBe(200);
    expect(res.body.title).toBe(validRecipe.title);
  });
});

describe("PATCH /recipes/:id", () => {
  it("updates only the fields sent, and can clear optional ones with null", async () => {
    const created = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, story: "Old story", servings: 4 });

    const res = await request(app)
      .patch(`/recipes/${created.body.id}`)
      .set(authed(alice))
      .send({ story: null, cookMinutes: 20 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: validRecipe.title,
      story: null,
      cookMinutes: 20,
      servings: 4,
    });
  });
});

describe("story and imageUrl normalization", () => {
  let recipeId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, story: "Kept story", imageUrl: "https://example.com/kept.jpg" });
    recipeId = res.body.id;
  });

  it.each([
    ["empty strings", ""],
    ["whitespace-only strings", "  \n\t "],
  ])("stores %s as null on create", async (_label, blank) => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, story: blank, imageUrl: blank });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ story: null, imageUrl: null });

    const stored = await prisma.recipe.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored).toMatchObject({ story: null, imageUrl: null });
  });

  it("trims surrounding whitespace on create", async () => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({
        ...validRecipe,
        story: "  \nA family recipe.\n\nSecond paragraph.  \n",
        imageUrl: "  https://example.com/pancakes.jpg  ",
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      story: "A family recipe.\n\nSecond paragraph.",
      imageUrl: "https://example.com/pancakes.jpg",
    });
  });

  it.each([
    "https://example.com/a.jpg",
    "http://example.com/a.jpg",
    "HTTPS://Example.com/A.JPG",
    // Not parseable by new URL(), but matches the pattern the app also uses.
    "https://[",
  ])(
    "accepts the image URL %s",
    async (imageUrl) => {
      const res = await request(app)
        .post("/recipes")
        .set(authed(alice))
        .send({ ...validRecipe, imageUrl });

      expect(res.status).toBe(201);
      expect(typeof res.body.imageUrl).toBe("string");
    },
  );

  it("clears story and imageUrl on PATCH when sent blank", async () => {
    const created = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, story: "To be cleared", imageUrl: "https://example.com/x.jpg" });

    const res = await request(app)
      .patch(`/recipes/${created.body.id}`)
      .set(authed(alice))
      .send({ story: "   ", imageUrl: "" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ story: null, imageUrl: null });

    const stored = await prisma.recipe.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored).toMatchObject({ story: null, imageUrl: null });
  });

  it("trims story and imageUrl on PATCH", async () => {
    const created = await request(app).post("/recipes").set(authed(alice)).send(validRecipe);

    const res = await request(app)
      .patch(`/recipes/${created.body.id}`)
      .set(authed(alice))
      .send({ story: "  New story ", imageUrl: " http://example.com/new.png " });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      story: "New story",
      imageUrl: "http://example.com/new.png",
    });
  });

  const invalidUrls = [
    "notalink",
    "ftp://x",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "//example.com/a.jpg",
    "https://",
    "https://exa mple.com/a.jpg",
  ];

  it.each(invalidUrls)("rejects the image URL %j on POST", async (imageUrl) => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, imageUrl });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("imageUrl must be an http(s) URL");
  });

  it.each(invalidUrls)("rejects the image URL %j on PATCH and keeps the old one", async (imageUrl) => {
    const res = await request(app)
      .patch(`/recipes/${recipeId}`)
      .set(authed(alice))
      .send({ imageUrl, story: "Should not be saved" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("imageUrl must be an http(s) URL");

    const stored = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } });
    expect(stored).toMatchObject({ story: "Kept story", imageUrl: "https://example.com/kept.jpg" });
  });

  it("rejects a non-string imageUrl", async () => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, imageUrl: 42 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("imageUrl must be a string or null");
  });
});

describe("source", () => {
  async function stored(id: string) {
    return (await prisma.recipe.findUniqueOrThrow({ where: { id } })).source;
  }

  it("saves a trimmed source on create and returns it on every read", async () => {
    const created = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, source: "  @someone \n" });

    expect(created.status).toBe(201);
    expect(created.body.source).toBe("@someone");
    expect(await stored(created.body.id)).toBe("@someone");

    const detail = await request(app).get(`/recipes/${created.body.id}`).set(authed(alice));
    expect(detail.body.source).toBe("@someone");

    const list = await request(app).get("/recipes").set(authed(alice));
    const listed = list.body.find((r: { id: string }) => r.id === created.body.id);
    expect(listed.source).toBe("@someone");
  });

  it.each([
    ["omitted", {}],
    ["null", { source: null }],
    ["an empty string", { source: "" }],
    ["whitespace only", { source: " \n\t " }],
  ])("stores null when the source is %s", async (_label, body) => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, ...body });

    expect(res.status).toBe(201);
    expect(res.body.source).toBeNull();
    expect(await stored(res.body.id)).toBeNull();
  });

  it.each([
    ["exactly 100 characters", "a".repeat(100)],
    ["100 characters with spaces around (measured after trimming)", `  ${"a".repeat(100)}  `],
    ["free text", "Mom's handwritten card"],
    ["non-Latin text", "Annemin tarif defteri – ğüşöç"],
  ])("accepts %s", async (_label, source) => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, source });

    expect(res.status).toBe(201);
    expect(res.body.source).toBe(source.trim());
  });

  it("rejects 101 characters on create and saves nothing", async () => {
    const before = await prisma.recipe.count({ where: { userId: alice.id } });

    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, source: "a".repeat(101) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("source must be at most 100 characters");
    expect(await prisma.recipe.count({ where: { userId: alice.id } })).toBe(before);
  });

  it.each([
    ["a number", 42],
    ["a boolean", true],
    ["an array", ["@someone"]],
    ["an object", { handle: "@someone" }],
  ])("rejects %s on create", async (_label, source) => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, source });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("source must be a string or null");
  });

  describe("PATCH", () => {
    let recipeId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post("/recipes")
        .set(authed(alice))
        .send({ ...validRecipe, source: "Mom" });
      recipeId = res.body.id;
    });

    it("sets a trimmed source", async () => {
      const created = await request(app).post("/recipes").set(authed(alice)).send(validRecipe);

      const res = await request(app)
        .patch(`/recipes/${created.body.id}`)
        .set(authed(alice))
        .send({ source: " @someone " });

      expect(res.status).toBe(200);
      expect(res.body.source).toBe("@someone");
      expect(await stored(created.body.id)).toBe("@someone");
    });

    it("leaves the source alone when it isn't sent", async () => {
      const res = await request(app)
        .patch(`/recipes/${recipeId}`)
        .set(authed(alice))
        .send({ title: "Renamed" });

      expect(res.status).toBe(200);
      expect(res.body.source).toBe("Mom");
    });

    it.each([
      ["null", null],
      ["an empty string", ""],
      ["whitespace only", "   "],
    ])("clears the source with %s", async (_label, source) => {
      const created = await request(app)
        .post("/recipes")
        .set(authed(alice))
        .send({ ...validRecipe, source: "To be cleared" });

      const res = await request(app)
        .patch(`/recipes/${created.body.id}`)
        .set(authed(alice))
        .send({ source });

      expect(res.status).toBe(200);
      expect(res.body.source).toBeNull();
      expect(await stored(created.body.id)).toBeNull();
    });

    it.each([
      ["101 characters", "a".repeat(101), "source must be at most 100 characters"],
      ["a number", 7, "source must be a string or null"],
    ])("rejects %s and keeps the old source and title", async (_label, source, message) => {
      const res = await request(app)
        .patch(`/recipes/${recipeId}`)
        .set(authed(alice))
        .send({ source, title: "Should not be saved" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(message);
      const after = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } });
      expect(after.source).toBe("Mom");
      expect(after.title).not.toBe("Should not be saved");
    });

    it("returns 404 for another user's recipe and changes nothing", async () => {
      const res = await request(app)
        .patch(`/recipes/${recipeId}`)
        .set(authed(bob))
        .send({ source: "@hijacked" });

      expect(res.status).toBe(404);
      expect(await stored(recipeId)).toBe("Mom");
    });

    it("rejects a request without a session", async () => {
      const res = await request(app).patch(`/recipes/${recipeId}`).send({ source: "@x" });
      expect(res.status).toBe(401);
    });
  });

  it("does not show another user's recipe source", async () => {
    const created = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, source: "@private" });

    const res = await request(app).get(`/recipes/${created.body.id}`).set(authed(bob));
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty("source");
  });
});

describe("section headings", () => {
  it("saves heading lines as ordinary lines, in place", async () => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({
        ...validRecipe,
        ingredients: ["# For the cake", "2 cups flour", "# For the cream", "200 ml cream"],
        instructions: "# For the cake\nBake 30 min.\n# For the cream\nWhip.",
      });

    expect(res.status).toBe(201);
    expect(res.body.ingredients).toEqual(["# For the cake", "2 cups flour", "# For the cream", "200 ml cream"]);
    expect(res.body.instructions).toBe("# For the cake\nBake 30 min.\n# For the cream\nWhip.");
  });
});

describe("minutes and servings upper bound", () => {
  const fields = ["prepMinutes", "cookMinutes", "servings"] as const;
  let recipeId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, prepMinutes: 1, cookMinutes: 2, servings: 3 });
    recipeId = res.body.id;
  });

  it.each(fields)("accepts %s = 10000 on POST", async (field) => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, [field]: 10000 });

    expect(res.status).toBe(201);
    expect(res.body[field]).toBe(10000);
  });

  it.each(fields)("accepts %s = 10000 on PATCH", async (field) => {
    const res = await request(app)
      .patch(`/recipes/${recipeId}`)
      .set(authed(alice))
      .send({ [field]: 10000 });

    expect(res.status).toBe(200);
    expect(res.body[field]).toBe(10000);
  });

  const tooBig = fields.flatMap((field) => [
    [field, 10001],
    [field, 99999999999],
  ] as const);

  it.each(tooBig)("rejects %s = %d on POST", async (field, value) => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, [field]: value });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`${field} must be at most 10000`);
  });

  it.each(tooBig)("rejects %s = %d on PATCH and keeps the old value", async (field, value) => {
    const before = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } });

    const res = await request(app)
      .patch(`/recipes/${recipeId}`)
      .set(authed(alice))
      .send({ [field]: value });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`${field} must be at most 10000`);

    const after = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } });
    expect(after[field]).toBe(before[field]);
  });

  it("still reports fractional values as non-integers, not as too big", async () => {
    const res = await request(app)
      .post("/recipes")
      .set(authed(alice))
      .send({ ...validRecipe, cookMinutes: 10000.5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("cookMinutes must be a non-negative integer or null");
  });
});

describe("DELETE /recipes/:id", () => {
  it("deletes the recipe", async () => {
    const created = await request(app).post("/recipes").set(authed(alice)).send(validRecipe);

    const del = await request(app).delete(`/recipes/${created.body.id}`).set(authed(alice));
    expect(del.status).toBe(204);

    const get = await request(app).get(`/recipes/${created.body.id}`).set(authed(alice));
    expect(get.status).toBe(404);
  });
});
