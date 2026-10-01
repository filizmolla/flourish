import express, { ErrorRequestHandler, Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getLlmModel, LlmError, readRecipesFromPhotos } from "../llm.js";
import { DecodedPhoto, getStorageDir, readImageInfo, saveImportPhotos } from "../importPhotos.js";

export const importsRouter = Router();

export const MAX_PHOTOS = 5;

// The app shrinks photos before sending (300 KB–1 MB each), so 5 of them in
// base64 fit well under this; Gemini's inline limit is about 20 MB a request.
const PARSE_BODY_LIMIT = "10mb";

// recipe_import.error is for analysis; the provider's message is already
// shortened in llm.ts, this only caps anything unexpected.
const MAX_ERROR_LENGTH = 1000;

// How many recipes the model read for an import: its result is
// { recipes: [...] } once DONE, and null while PENDING or after a failure.
export function parsedRecipeCount(result: Prisma.JsonValue): number {
  const recipes = (result as { recipes?: unknown } | null)?.recipes;
  return Array.isArray(recipes) ? recipes.length : 0;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

// Checks the images and decodes them; returns an error message, or the photos.
function decodeImages(images: unknown): { error: string } | { photos: DecodedPhoto[] } {
  if (!Array.isArray(images) || images.length === 0) {
    return { error: "images must be a non-empty array" };
  }
  if (images.length > MAX_PHOTOS) {
    return { error: `At most ${MAX_PHOTOS} images are allowed` };
  }

  const photos: DecodedPhoto[] = [];
  for (const [index, image] of images.entries()) {
    if (typeof image !== "string" || !BASE64_PATTERN.test(image)) {
      return { error: `images[${index}] must be a base64 string` };
    }
    const data = Buffer.from(image, "base64");
    const info = readImageInfo(data);
    if (!info) {
      return { error: `images[${index}] is not a JPEG or PNG` };
    }
    photos.push({ data, ...info });
  }
  return { photos };
}

// Mounted before the global express.json() in app.ts, so the upload gets its
// own body limit; auth runs first, so a large body is only parsed when signed in.
importsRouter.use(requireAuth);

importsRouter.post("/parse", express.json({ limit: PARSE_BODY_LIMIT }), async (req, res) => {
  const decoded = decodeImages(req.body?.images);
  if ("error" in decoded) {
    res.status(400).json({ error: decoded.error });
    return;
  }

  const storageDir = getStorageDir();
  if (!storageDir) {
    throw new Error("STORAGE_DIR must be set to keep import photos");
  }

  const userId = req.userId!;
  const recipeImport = await prisma.recipeImport.create({
    data: { userId, photoCount: decoded.photos.length, model: getLlmModel() },
  });

  // Photos are kept before the model is called, so failed and no-recipe
  // imports keep theirs too (the most useful ones to study).
  try {
    await saveImportPhotos(storageDir, userId, recipeImport.id, decoded.photos);
  } catch (error) {
    await prisma.recipeImport.update({
      where: { id: recipeImport.id },
      data: {
        status: "FAILED",
        error: `storage: ${error instanceof Error ? error.message : String(error)}`.slice(0, MAX_ERROR_LENGTH),
        closedAt: new Date(),
      },
    });
    throw error;
  }

  const started = performance.now();
  try {
    const recipes = await readRecipesFromPhotos(
      decoded.photos.map((photo, index) => ({ base64: req.body.images[index], mimeType: photo.mimeType })),
    );
    const durationMs = Math.round(performance.now() - started);
    const found = recipes.length > 0;

    await prisma.recipeImport.update({
      where: { id: recipeImport.id },
      data: {
        status: found ? "DONE" : "NO_RECIPE",
        durationMs,
        result: { recipes } satisfies Prisma.InputJsonValue,
        // Nothing to review, so the queue is over.
        ...(!found && { closedAt: new Date() }),
      },
    });

    // Shaped like POST /recipes, so the app can prefill the form as is:
    // one step per line in instructions.
    res.json({
      importId: recipeImport.id,
      recipes: recipes.map((recipe) => ({
        title: recipe.title,
        source: recipe.source,
        ingredients: recipe.ingredients,
        instructions: recipe.steps.join("\n"),
      })),
    });
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const message =
      error instanceof LlmError
        ? `${error.reason}: ${error.message}`
        : `unexpected: ${error instanceof Error ? error.message : String(error)}`;

    await prisma.recipeImport.update({
      where: { id: recipeImport.id },
      data: {
        status: "FAILED",
        durationMs,
        error: message.slice(0, MAX_ERROR_LENGTH),
        closedAt: new Date(),
      },
    });

    if (!(error instanceof LlmError)) throw error;

    // One message for the whole set, never a half-filled recipe; the app
    // keeps the photos and offers Try again.
    res.status(502).json({ error: "Couldn't read the photos", importId: recipeImport.id });
  }
});

// One photo of an import, owner only: another user's import, a position that
// doesn't exist and a missing file all return 404. For analysis now, and for
// showing the original photos in the app later.
importsRouter.get("/:id/photos/:position", async (req, res) => {
  const notFound = () => res.status(404).json({ error: "Photo not found" });

  // Positions are 0 to MAX_PHOTOS - 1; checking here also keeps a huge
  // number from reaching the database as an Int.
  if (!/^\d+$/.test(req.params.position) || Number(req.params.position) >= MAX_PHOTOS) {
    notFound();
    return;
  }

  const photo = await prisma.importPhoto.findFirst({
    where: {
      position: Number(req.params.position),
      import: { id: req.params.id, userId: req.userId },
    },
  });
  const storageDir = getStorageDir();
  if (!photo || !storageDir) {
    notFound();
    return;
  }

  // root keeps the stored relative path inside STORAGE_DIR.
  res.sendFile(
    photo.path,
    {
      root: storageDir,
      headers: { "Content-Type": photo.mimeType, "Cache-Control": "private, no-cache" },
    },
    (error) => {
      if (!error || res.headersSent) return;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        notFound();
        return;
      }
      res.status(500).json({ error: "Couldn't read the photo" });
    },
  );
});

// The review queue's progress, owner only (404 otherwise):
// { reviewedCount } for Skip this one and { closed: true } for Stop importing,
// either or both. reviewedCount only goes up (the same value again is a
// no-op, so a retried Skip is fine) and never past the parsed count;
// reaching the end closes the import too. A closed import stays closed.
importsRouter.patch("/:id", express.json(), async (req, res) => {
  const { reviewedCount, closed } = req.body ?? {};

  if (reviewedCount === undefined && closed === undefined) {
    res.status(400).json({ error: "Send reviewedCount or closed" });
    return;
  }
  if (reviewedCount !== undefined && (!Number.isInteger(reviewedCount) || reviewedCount < 0)) {
    res.status(400).json({ error: "reviewedCount must be a non-negative integer" });
    return;
  }
  if (closed !== undefined && closed !== true) {
    res.status(400).json({ error: "closed can only be true" });
    return;
  }

  const recipeImport = await prisma.recipeImport.findFirst({
    where: { id: req.params.id, userId: req.userId },
    select: { id: true, status: true, result: true, reviewedCount: true },
  });
  if (!recipeImport) {
    res.status(404).json({ error: "Import not found" });
    return;
  }
  // Still being read: there is no queue yet, and closing it now would leave
  // a DONE import closed before anything was reviewed.
  if (recipeImport.status === "PENDING") {
    res.status(409).json({ error: "The photos are still being read" });
    return;
  }

  const parsedCount = parsedRecipeCount(recipeImport.result);
  if (reviewedCount !== undefined) {
    if (reviewedCount > parsedCount) {
      res.status(400).json({ error: `reviewedCount must be at most ${parsedCount}` });
      return;
    }
    if (reviewedCount < recipeImport.reviewedCount) {
      res.status(400).json({ error: `reviewedCount can't go down from ${recipeImport.reviewedCount}` });
      return;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (reviewedCount !== undefined) {
      // Conditional, so a save that moved the count further meanwhile wins.
      await tx.recipeImport.updateMany({
        where: { id: recipeImport.id, reviewedCount: { lt: reviewedCount } },
        data: { reviewedCount },
      });
    }
    await tx.recipeImport.updateMany({
      where: {
        id: recipeImport.id,
        closedAt: null,
        ...(closed ? {} : { reviewedCount: { gte: parsedCount } }),
      },
      data: { closedAt: new Date() },
    });
    return tx.recipeImport.findUniqueOrThrow({
      where: { id: recipeImport.id },
      select: { id: true, status: true, reviewedCount: true, closedAt: true },
    });
  });

  res.json(updated);
});

// Body errors from this router's own parsers get a JSON error instead of
// Express's default HTML page.
const bodyErrors: ErrorRequestHandler = (error, _req, res, next) => {
  const type = (error as { type?: string }).type;
  if (type === "entity.too.large") {
    res.status(413).json({ error: "The photos are too large" });
    return;
  }
  if (type === "entity.parse.failed") {
    res.status(400).json({ error: "The request body is not valid JSON" });
    return;
  }
  next(error);
};
importsRouter.use(bodyErrors);

// Imports still PENDING when the server starts were cut off by a restart
// mid-read: no reply will ever arrive, so they fail and close. Called from
// index.ts, not app.ts, so tests aren't affected. Returns how many.
export async function failInterruptedImports(): Promise<number> {
  const { count } = await prisma.recipeImport.updateMany({
    where: { status: "PENDING" },
    data: { status: "FAILED", error: "interrupted: the server restarted before the reply", closedAt: new Date() },
  });
  return count;
}
