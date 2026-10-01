// The Express app without a listening socket, so tests can drive it with supertest.
import express from "express";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { prisma } from "./prisma.js";
import { auth } from "./auth.js";
import { recipesRouter } from "./routes/recipes.js";
import { attemptsRouter, recipeAttemptsRouter } from "./routes/attempts.js";
import { importsRouter } from "./routes/imports.js";
import { ingredientsRouter } from "./routes/ingredients.js";
import { mealsRouter } from "./routes/meals.js";
import { weekRouter } from "./routes/week.js";

export const app = express();

// Must be mounted before express.json() — Better Auth parses the raw request body itself.
app.all("/api/auth/*splat", toNodeHandler(auth));

// Before express.json() too: photo uploads need a larger body limit than the
// global 100 KB, so these routers parse their own bodies (a Finish can
// carry a photo too).
app.use("/imports", importsRouter);
app.use("/meals", mealsRouter);
app.use("/recipes/:recipeId/attempts", recipeAttemptsRouter);

app.use(express.json());

app.get("/health", async (_req, res) => {
  // The database name tells which server this is (flourish / flourish_demo / flourish_test).
  const [{ database }] = await prisma.$queryRaw<{ database: string }[]>`
    SELECT current_database() AS database`;
  res.json({ status: "ok", db: "connected", database });
});

app.get("/me", async (req, res) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json(session.user);
});

app.use("/recipes", recipesRouter);
app.use("/attempts", attemptsRouter);
app.use("/ingredients", ingredientsRouter);
app.use("/week", weekRouter);
