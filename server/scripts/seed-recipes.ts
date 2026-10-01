import "dotenv/config";
import { prisma } from "../src/prisma.js";
import { seedRecipes } from "./data/recipes.js";

// Seeds the sample recipes into an existing user's account. Safe to re-run:
// recipes whose title already exists for that user are skipped.
const email = process.env.SEED_USER_EMAIL;

if (!email) {
  console.error("Set SEED_USER_EMAIL to the account that should own the sample recipes.");
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { email } });

if (!user) {
  console.error(`No user with email ${email}. Register one first (or run \`npm run seed:user\`).`);
  process.exit(1);
}

const existingTitles = new Set(
  (await prisma.recipe.findMany({ where: { userId: user.id }, select: { title: true } })).map(
    (r) => r.title,
  ),
);

const DAY_MS = 24 * 60 * 60 * 1000;
let created = 0;

for (const { daysAgo, ...recipe } of seedRecipes) {
  if (existingTitles.has(recipe.title)) continue;

  const postedAt = new Date(Date.now() - daysAgo * DAY_MS);
  await prisma.recipe.create({
    data: {
      ...recipe,
      // Phase 5: the lines table; recipe.ingredients stays in sync until it's dropped.
      lines: { create: recipe.ingredients.map((text, position) => ({ position, text })) },
      userId: user.id,
      createdAt: postedAt,
      updatedAt: postedAt,
    },
  });
  created++;
}

console.log(
  `Seeded ${created} recipe(s) for ${email} (${seedRecipes.length - created} already existed).`,
);
await prisma.$disconnect();
