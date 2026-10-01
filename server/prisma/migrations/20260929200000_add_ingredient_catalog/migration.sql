-- CreateEnum
CREATE TYPE "Nutrient" AS ENUM ('PROTEIN', 'FIBER', 'HEALTHY_FAT');

-- CreateEnum
CREATE TYPE "FoodGroup" AS ENUM ('PROTEIN', 'FIBER', 'HEALTHY_FAT', 'CARB');

-- CreateTable
CREATE TABLE "ingredient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "aliases" TEXT[],
    "mainGroup" "FoodGroup",
    "nutrients" "Nutrient"[],
    "description" TEXT,
    "fdcId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredient" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "ingredientId" TEXT,

    CONSTRAINT "recipe_ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_normalizedName_key" ON "ingredient"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_fdcId_key" ON "ingredient"("fdcId");

-- CreateIndex
CREATE INDEX "recipe_ingredient_ingredientId_idx" ON "recipe_ingredient"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_ingredient_recipeId_position_key" ON "recipe_ingredient"("recipeId", "position");

-- AddForeignKey
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Copy every recipe's ingredient lines into recipe_ingredient, in order
-- (position is 0-based), unlinked. recipe.ingredients stays for now and the
-- server keeps both in sync; a later migration drops it once the app has run
-- on the new table for a few days.
INSERT INTO "recipe_ingredient" ("id", "recipeId", "position", "text")
SELECT gen_random_uuid()::text, r."id", line.ordinality - 1, line.text
FROM "recipe" r
CROSS JOIN LATERAL unnest(r."ingredients") WITH ORDINALITY AS line(text, ordinality);
