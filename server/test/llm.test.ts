import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmError, MAX_RECIPES, parseReply, readRecipesFromPhotos, type LlmErrorReason, type PhotoInput } from "../src/llm.js";

const LLM_VARS = ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "LLM_REASONING_EFFORT"] as const;

type RawRecipe = { title: unknown; source: unknown; ingredients: unknown; steps: unknown };

function makeRecipe(overrides: Partial<RawRecipe> = {}): RawRecipe {
  return { title: "Lentil soup", source: "", ingredients: ["1 cup lentils"], steps: ["Boil the lentils."], ...overrides };
}

// A chat-completions payload whose message content is the given value
// (JSON-encoded unless it's already a string).
function chatPayload(content: unknown) {
  return {
    choices: [{ message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } }],
  };
}

function jpeg(base64: string): PhotoInput {
  return { base64, mimeType: "image/jpeg" };
}

function expectLlmError(fn: () => unknown, reason: LlmErrorReason) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).reason).toBe(reason);
    return error as LlmError;
  }
  throw new Error(`Expected LlmError "${reason}", but nothing was thrown`);
}

async function expectLlmRejection(promise: Promise<unknown>, reason: LlmErrorReason) {
  const error = await promise.then(
    () => {
      throw new Error(`Expected LlmError "${reason}", but the promise resolved`);
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LlmError);
  expect((error as LlmError).reason).toBe(reason);
  return error as LlmError;
}

describe("parseReply", () => {
  it("returns one recipe with title and lines trimmed", () => {
    const recipes = parseReply(
      chatPayload({
        recipes: [makeRecipe({ title: "  Lentil soup \n", ingredients: ["  1 cup lentils  "], steps: [" Boil. "] })],
      }),
    );
    expect(recipes).toEqual([{ title: "Lentil soup", source: "", ingredients: ["1 cup lentils"], steps: ["Boil."] }]);
  });

  it("trims the source", () => {
    const [recipe] = parseReply(chatPayload({ recipes: [makeRecipe({ source: "  @someone \n" })] }));
    expect(recipe.source).toBe("@someone");
  });

  it("keeps an empty source when the photos credit no one", () => {
    const [recipe] = parseReply(chatPayload({ recipes: [makeRecipe({ source: "   " })] }));
    expect(recipe.source).toBe("");
  });

  it.each([
    ["exactly 100 characters", "a".repeat(100), "a".repeat(100)],
    ["101 characters, cut to 100", "b".repeat(101), "b".repeat(100)],
    ["a long credit, cut to 100", "c".repeat(500), "c".repeat(100)],
    ["100 characters with spaces around, trimmed before cutting", `  ${"d".repeat(100)}  `, "d".repeat(100)],
  ])("keeps a source of %s", (_, source, expected) => {
    const [recipe] = parseReply(chatPayload({ recipes: [makeRecipe({ source })] }));
    expect(recipe.source).toBe(expected);
  });

  it("keeps section heading lines as they are", () => {
    const [recipe] = parseReply(
      chatPayload({
        recipes: [
          makeRecipe({
            ingredients: ["# For the cake", "2 cups flour", " # For the cream ", "200 ml cream"],
            steps: ["# For the cake", "Bake 30 min."],
          }),
        ],
      }),
    );
    expect(recipe.ingredients).toEqual(["# For the cake", "2 cups flour", "# For the cream", "200 ml cream"]);
    expect(recipe.steps).toEqual(["# For the cake", "Bake 30 min."]);
  });

  it("returns several recipes in order", () => {
    const recipes = parseReply(
      chatPayload({
        recipes: [
          makeRecipe({ title: " Dough ", ingredients: [" flour "], steps: [" Knead. "] }),
          makeRecipe({ title: "Sauce", ingredients: ["tomatoes"], steps: ["Simmer."] }),
        ],
      }),
    );
    expect(recipes).toEqual([
      { title: "Dough", source: "", ingredients: ["flour"], steps: ["Knead."] },
      { title: "Sauce", source: "", ingredients: ["tomatoes"], steps: ["Simmer."] },
    ]);
  });

  it("drops blank ingredient and step lines", () => {
    const [recipe] = parseReply(
      chatPayload({ recipes: [makeRecipe({ ingredients: ["", "salt", "   ", "\n"], steps: ["Mix.", " ", ""] })] }),
    );
    expect(recipe.ingredients).toEqual(["salt"]);
    expect(recipe.steps).toEqual(["Mix."]);
  });

  it("turns a line break inside a line into a single space", () => {
    const [recipe] = parseReply(
      chatPayload({
        recipes: [makeRecipe({ ingredients: ["2 cups\nflour"], steps: ["Mix the flour  \n  with water.", "Bake\r\nfor 20 min."] })],
      }),
    );
    expect(recipe.ingredients).toEqual(["2 cups flour"]);
    expect(recipe.steps).toEqual(["Mix the flour with water.", "Bake for 20 min."]);
  });

  it("keeps an empty title and allows empty steps", () => {
    const [recipe] = parseReply(chatPayload({ recipes: [makeRecipe({ title: "  ", steps: [] })] }));
    expect(recipe.title).toBe("");
    expect(recipe.steps).toEqual([]);
  });

  it("returns [] for an empty recipes list", () => {
    expect(parseReply(chatPayload({ recipes: [] }))).toEqual([]);
  });

  it.each([
    ["null payload", null],
    ["payload without choices", {}],
    ["empty choices", { choices: [] }],
    ["choice without message", { choices: [{}] }],
    ["message without content", { choices: [{ message: {} }] }],
    ["null content", { choices: [{ message: { content: null } }] }],
    ["non-string content", { choices: [{ message: { content: { recipes: [] } } }] }],
  ])("throws invalid_reply for %s", (_, payload) => {
    const error = expectLlmError(() => parseReply(payload), "invalid_reply");
    expect(error.message).toBe("Reply has no message content");
  });

  it("throws invalid_reply when the content isn't JSON", () => {
    const error = expectLlmError(() => parseReply(chatPayload("Here is your recipe: soup")), "invalid_reply");
    expect(error.message).toBe("Message content is not JSON");
  });

  it.each([
    ["recipes missing", {}],
    ["recipes not an array", { recipes: "soup" }],
    ["steps missing", { recipes: [{ title: "Soup", source: "", ingredients: ["water"] }] }],
    ["title missing", { recipes: [{ source: "", ingredients: ["water"], steps: ["Boil."] }] }],
    ["source missing", { recipes: [{ title: "Soup", ingredients: ["water"], steps: ["Boil."] }] }],
    ["source not a string", { recipes: [makeRecipe({ source: null })] }],
    ["ingredients not strings", { recipes: [makeRecipe({ ingredients: [1, 2] })] }],
    ["ingredients one string", { recipes: [makeRecipe({ ingredients: "water" })] }],
    ["title not a string", { recipes: [makeRecipe({ title: 42 })] }],
  ])("throws invalid_reply on schema mismatch: %s", (_, content) => {
    const error = expectLlmError(() => parseReply(chatPayload(content)), "invalid_reply");
    expect(error.message).toMatch(/^Reply doesn't match the schema/);
  });

  it(`accepts exactly MAX_RECIPES (${MAX_RECIPES}) recipes`, () => {
    const recipes = Array.from({ length: MAX_RECIPES }, (_, i) => makeRecipe({ title: `R${i}` }));
    expect(parseReply(chatPayload({ recipes }))).toHaveLength(MAX_RECIPES);
  });

  it("throws invalid_reply for more than MAX_RECIPES recipes", () => {
    const recipes = Array.from({ length: MAX_RECIPES + 1 }, (_, i) => makeRecipe({ title: `R${i}` }));
    const error = expectLlmError(() => parseReply(chatPayload({ recipes })), "invalid_reply");
    expect(error.message).toContain(`${MAX_RECIPES + 1} recipes`);
  });

  it.each([
    ["no ingredients", []],
    ["only blank ingredients", ["", "  ", "\n"]],
  ])("throws invalid_reply when a recipe has %s after cleaning", (_, ingredients) => {
    const content = { recipes: [makeRecipe(), makeRecipe({ ingredients })] };
    const error = expectLlmError(() => parseReply(chatPayload(content)), "invalid_reply");
    expect(error.message).toBe("A recipe in the reply has no ingredients");
  });
});

describe("readRecipesFromPhotos", () => {
  const saved: Partial<Record<(typeof LLM_VARS)[number], string>> = {};
  let fetchMock: ReturnType<typeof vi.fn>;

  const okReply = { recipes: [makeRecipe({ title: " Soup " })] };

  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  function lastRequest() {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return {
      url,
      init,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, any>,
    };
  }

  beforeEach(() => {
    for (const name of LLM_VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    process.env.LLM_BASE_URL = "https://llm.example.test/v1";
    process.env.LLM_MODEL = "test-model";
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(chatPayload(okReply)));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const name of LLM_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it.each([
    ["LLM_BASE_URL missing", "LLM_BASE_URL"],
    ["LLM_MODEL missing", "LLM_MODEL"],
  ] as const)("throws not_configured when %s and doesn't call fetch", async (_, name) => {
    delete process.env[name];
    await expectLlmRejection(readRecipesFromPhotos([jpeg("aaa")]), "not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws not_configured when LLM_MODEL is an empty string", async () => {
    process.env.LLM_MODEL = "";
    await expectLlmRejection(readRecipesFromPhotos([jpeg("aaa")]), "not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["without a trailing slash", "https://llm.example.test/v1"],
    ["with a trailing slash", "https://llm.example.test/v1/"],
    ["with several trailing slashes", "https://llm.example.test/v1//"],
  ])("posts to {base}/chat/completions %s", async (_, base) => {
    process.env.LLM_BASE_URL = base;
    await readRecipesFromPhotos([jpeg("aaa")]);
    const { url, init } = lastRequest();
    expect(url).toBe("https://llm.example.test/v1/chat/completions");
    expect(init.method).toBe("POST");
  });

  it("sends model, temperature 0, a json_schema response format, the system prompt and images in order", async () => {
    await readRecipesFromPhotos([jpeg("first"), jpeg("second"), jpeg("third")]);
    const { body, headers, init } = lastRequest();

    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(body.model).toBe("test-model");
    expect(body.temperature).toBe(0);

    expect(body.response_format.type).toBe("json_schema");
    const schema = body.response_format.json_schema.schema;
    expect(schema).toBeTypeOf("object");
    expect(schema).not.toHaveProperty("$schema");
    expect(schema.properties).toHaveProperty("recipes");

    const [system, user] = body.messages;
    expect(system.role).toBe("system");
    expect(system.content).toBeTypeOf("string");
    expect(system.content.length).toBeGreaterThan(0);
    expect(user.role).toBe("user");
    expect(user.content).toEqual([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,first" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,second" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,third" } },
    ]);
  });

  it("asks for a source on every recipe in the json schema", async () => {
    await readRecipesFromPhotos([jpeg("aaa")]);
    const recipe = lastRequest().body.response_format.json_schema.schema.properties.recipes.items;

    expect(recipe.properties.source).toEqual({ type: "string" });
    expect(recipe.required).toContain("source");
  });

  it("tells the model to write section headings as '# ' lines", async () => {
    await readRecipesFromPhotos([jpeg("aaa")]);
    const prompt: string = lastRequest().body.messages[0].content;

    expect(prompt).toContain(
      'section heading as its own line starting with "# ", without a trailing colon (for example "# For the cream")',
    );
    expect(prompt).toContain('Only section headings get "# "; never add it to anything else.');
    expect(prompt).not.toContain("Keep those headings as their own lines");
  });

  it("tells the model who counts as the source, and to leave it empty otherwise", async () => {
    await readRecipesFromPhotos([jpeg("aaa")]);
    const prompt: string = lastRequest().body.messages[0].content;

    expect(prompt).toContain('"source" is who the recipe is from');
    expect(prompt).toContain('written as "@" plus the handle exactly as shown');
    expect(prompt).toContain(
      'Never take it from comments, likes, tagged or mentioned accounts, "follow @…" lines or hashtags, and never guess. Otherwise use an empty string.',
    );
  });

  it("builds each data URL from the photo's own mimeType, keeping JPEG and PNG apart", async () => {
    await readRecipesFromPhotos([
      { base64: "screenshot", mimeType: "image/png" },
      jpeg("camera"),
      { base64: "second-shot", mimeType: "image/png" },
    ]);
    const [, user] = lastRequest().body.messages;
    expect(user.content.map((part: { image_url: { url: string } }) => part.image_url.url)).toEqual([
      "data:image/png;base64,screenshot",
      "data:image/jpeg;base64,camera",
      "data:image/png;base64,second-shot",
    ]);
  });

  it("sends no Authorization header and no reasoning_effort when those vars are unset", async () => {
    await readRecipesFromPhotos([jpeg("aaa")]);
    const { headers, body } = lastRequest();
    expect(headers).not.toHaveProperty("Authorization");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("sends Authorization: Bearer <key> when LLM_API_KEY is set", async () => {
    process.env.LLM_API_KEY = "secret-key";
    await readRecipesFromPhotos([jpeg("aaa")]);
    expect(lastRequest().headers.Authorization).toBe("Bearer secret-key");
  });

  it("sends reasoning_effort when LLM_REASONING_EFFORT is set", async () => {
    process.env.LLM_REASONING_EFFORT = "low";
    await readRecipesFromPhotos([jpeg("aaa")]);
    expect(lastRequest().body.reasoning_effort).toBe("low");
  });

  it("throws timeout when fetch rejects with a TimeoutError", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    const error = await expectLlmRejection(readRecipesFromPhotos([jpeg("aaa")], { timeoutMs: 1234 }), "timeout");
    expect(error.message).toContain("1234");
  });

  it("throws network when fetch rejects with any other error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const error = await expectLlmRejection(readRecipesFromPhotos([jpeg("aaa")]), "network");
    expect(error.message).toBe("fetch failed");
  });

  it("throws network when fetch rejects with a non-Error value", async () => {
    fetchMock.mockRejectedValue("connection refused");
    const error = await expectLlmRejection(readRecipesFromPhotos([jpeg("aaa")]), "network");
    expect(error.message).toBe("connection refused");
  });

  it.each([400, 429, 500, 503])("throws http with status %i in the message for a JSON error body", async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: "quota exceeded" } }, status));
    const error = await expectLlmRejection(readRecipesFromPhotos([jpeg("aaa")]), "http");
    expect(error.message).toContain(`HTTP ${status}`);
    expect(error.message).toContain("quota exceeded");
  });

  it("throws http with the status when a non-2xx body isn't JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    const error = await expectLlmRejection(readRecipesFromPhotos([jpeg("aaa")]), "http");
    expect(error.message).toContain("HTTP 502");
  });

  it("caps the provider's error text in the http message", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "x".repeat(2000) }, 500));
    const error = await expectLlmRejection(readRecipesFromPhotos([jpeg("aaa")]), "http");
    expect(error.message.length).toBeLessThanOrEqual("HTTP 500: ".length + 500);
  });

  it("throws invalid_reply when a 2xx body isn't JSON", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
    await expectLlmRejection(readRecipesFromPhotos([jpeg("aaa")]), "invalid_reply");
  });

  it("throws invalid_reply when a 2xx reply fails parseReply", async () => {
    fetchMock.mockResolvedValue(jsonResponse(chatPayload("not json")));
    await expectLlmRejection(readRecipesFromPhotos([jpeg("aaa")]), "invalid_reply");
  });

  it("returns the parsed, cleaned recipes on success", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        chatPayload({
          recipes: [
            makeRecipe({ title: " Soup ", source: " @soupkitchen ", ingredients: [" water ", ""], steps: ["Boil\nwell."] }),
            makeRecipe({ title: "Bread" }),
          ],
        }),
      ),
    );
    await expect(readRecipesFromPhotos([jpeg("aaa"), jpeg("bbb")])).resolves.toEqual([
      { title: "Soup", source: "@soupkitchen", ingredients: ["water"], steps: ["Boil well."] },
      { title: "Bread", source: "", ingredients: ["1 cup lentils"], steps: ["Boil the lentils."] },
    ]);
  });
});
