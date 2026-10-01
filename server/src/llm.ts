// Reads recipes from photos with a multimodal model, through one
// OpenAI-compatible chat-completions call. Plain fetch, no SDK: this is the
// only call site, and the same request shape works for Gemini's
// OpenAI-compatible endpoint and for Ollama, so switching is an env change
// (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, optional LLM_REASONING_EFFORT).
// LLM_FAKE_REPLY (E2E server only) answers from a file instead of a model.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { PhotoMimeType } from "./importPhotos.js";

// At most 5 photos per import, so more recipes than that means the model
// is splitting one dish or inventing recipes.
export const MAX_RECIPES = 5;

const DEFAULT_TIMEOUT_MS = 60_000;

// Same cap as recipe.source in routes/recipes.ts (not imported from there:
// that module imports this one through the imports routes).
const MAX_SOURCE_LENGTH = 100;

// What the model must return; sent as the JSON schema and reused to check
// the reply. Strings and string arrays only, so z.toJSONSchema can convert it.
const replySchema = z.object({
  recipes: z.array(
    z.object({
      title: z.string(),
      // Who the recipe is credited to; "" when the photos don't say.
      source: z.string(),
      ingredients: z.array(z.string()),
      steps: z.array(z.string()),
    }),
  ),
});

export type ParsedRecipe = z.infer<typeof replySchema>["recipes"][number];

const PROMPT = `You read recipes from photos: cookbook pages, recipe cards, handwritten notes and screenshots. The photos may be in any language.

Return every recipe you find as JSON matching the schema. An empty "recipes" list means the photos hold no recipe.

Rules:
- Copy what the photos say. Keep the original language; never translate.
- Keep each ingredient line as written, with its amount and unit exactly as shown (for example "1/2 cup", "1 çay bardağı", "2 yemek kaşığı"). Never guess a missing amount.
- Every recipe has ingredients. When there is no separate ingredient list, take them from the method text in the order they appear, in the text's own words, one per line, with the amount only if the text gives it (for example "2 яйца", "tortillas", "grated cheese"). Leave the method text unchanged in "steps".
- Invent nothing: no missing ingredients, no missing steps, no title that isn't there. If there is no title, use an empty string.
- "source" is who the recipe is from, only when the photos clearly credit someone: the account that posted it (for example the name at the top of an Instagram or TikTok post), written as "@" plus the handle exactly as shown, or a person, cookbook or site named as the recipe's author ("Recipe by …", "From …"). Never take it from comments, likes, tagged or mentioned accounts, "follow @…" lines or hashtags, and never guess. Otherwise use an empty string.
- Text cut off at the edge of the photo: keep what is readable, never complete it.
- Leave out labels that only point to pictures, such as "2 -" or "Fig. 3" in front of a sentence.
- One dish is one recipe, even when it has parts such as "For the dough" and "For the sauce". Write each such section heading as its own line starting with "# ", without a trailing colon (for example "# For the cream"), in "ingredients" or "steps", right before the lines it covers. Only section headings get "# "; never add it to anything else. Only separate dishes become separate recipes.
- "steps" is a list even when the method is one paragraph: split it at each action, usually 1–3 sentences per step. Keep the original wording and every number. Never merge, reorder, reword or add steps.
- A recipe that continues across photos is still one recipe; the photos are in order.
- Ignore everything that isn't part of a recipe: page numbers, ads, notifications, comments, captions unrelated to the recipe.`;

export type LlmErrorReason = "not_configured" | "timeout" | "network" | "http" | "invalid_reply";

// One error type for every way the call can fail, so the caller can record
// the reason and never ends up with a half-filled recipe.
export class LlmError extends Error {
  constructor(
    readonly reason: LlmErrorReason,
    message: string,
    // The model's message content, when one arrived but was rejected.
    readonly content?: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export function getLlmModel() {
  if (process.env.LLM_FAKE_REPLY) return "fake";
  return process.env.LLM_MODEL ?? "";
}

// For Detox: no network and no quota. The file maps a photo count to the
// model's JSON reply ({ "1": { "recipes": [...] }, ... }), so a spec picks a
// reply by how many photos it sends; a count with no entry fails like a bad
// reply. It goes through the same checks as a real reply.
async function readFakeReply(file: string, photoCount: number): Promise<ParsedRecipe[]> {
  const replies = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  const reply = replies[String(photoCount)];
  if (reply === undefined) {
    throw new LlmError("invalid_reply", `No fake reply for ${photoCount} photos in ${file}`);
  }
  return parseReply({ choices: [{ message: { content: JSON.stringify(reply) } }] });
}

// base64: the image bytes (no data-URL prefix); mimeType: image/jpeg or image/png.
export type PhotoInput = { base64: string; mimeType: PhotoMimeType };

// images: in the order the user picked them.
export async function readRecipesFromPhotos(
  images: PhotoInput[],
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<ParsedRecipe[]> {
  const fakeReply = process.env.LLM_FAKE_REPLY;
  if (fakeReply) return readFakeReply(fakeReply, images.length);

  const baseUrl = process.env.LLM_BASE_URL;
  const model = getLlmModel();
  if (!baseUrl || !model) {
    throw new LlmError("not_configured", "LLM_BASE_URL and LLM_MODEL must be set");
  }

  const { $schema: _, ...jsonSchema } = z.toJSONSchema(replySchema);
  const reasoningEffort = process.env.LLM_REASONING_EFFORT;

  const body = {
    model,
    temperature: 0,
    // Only when set: Ollama doesn't know this option.
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    response_format: {
      type: "json_schema",
      json_schema: { name: "recipes", strict: true, schema: jsonSchema },
    },
    messages: [
      { role: "system", content: PROMPT },
      {
        role: "user",
        content: images.map((image) => ({
          type: "image_url",
          image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
        })),
      },
    ],
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new LlmError("timeout", `No reply within ${timeoutMs} ms`);
    }
    throw new LlmError("network", error instanceof Error ? error.message : String(error));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new LlmError("timeout", `No reply within ${timeoutMs} ms`);
    }
    throw new LlmError(response.ok ? "invalid_reply" : "http", `Reply is not JSON (HTTP ${response.status})`);
  }

  if (!response.ok) {
    // Keep the provider's message short; it goes into recipe_import.error.
    throw new LlmError("http", `HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  return parseReply(payload);
}

// Checks the chat-completions payload and the recipes inside it, plus the
// rules the JSON schema can't carry. Exported for tests.
export function parseReply(payload: unknown): ParsedRecipe[] {
  const content = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;
  if (typeof content !== "string") {
    throw new LlmError("invalid_reply", "Reply has no message content");
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new LlmError("invalid_reply", "Message content is not JSON", content);
  }

  const parsed = replySchema.safeParse(json);
  if (!parsed.success) {
    throw new LlmError("invalid_reply", `Reply doesn't match the schema: ${parsed.error.message}`, content);
  }

  const recipes = parsed.data.recipes.map((recipe) => ({
    title: recipe.title.trim(),
    // The recipe routes cap source at 100; a longer credit is cut, not refused.
    source: recipe.source.trim().slice(0, MAX_SOURCE_LENGTH),
    ingredients: cleanLines(recipe.ingredients),
    steps: cleanLines(recipe.steps),
  }));

  if (recipes.length > MAX_RECIPES) {
    throw new LlmError("invalid_reply", `Reply has ${recipes.length} recipes, at most ${MAX_RECIPES} allowed`, content);
  }
  if (recipes.some((recipe) => recipe.ingredients.length === 0)) {
    throw new LlmError("invalid_reply", "A recipe in the reply has no ingredients", content);
  }

  return recipes;
}

// Steps are later joined with newlines into recipe.instructions (one step
// per line), so a line break inside a line would split it in two.
function cleanLines(lines: string[]) {
  return lines.map((line) => line.replace(/\s*\n\s*/g, " ").trim()).filter((line) => line !== "");
}
