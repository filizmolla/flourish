-- AlterTable
ALTER TABLE "recipe" ADD COLUMN     "forkedFromAttemptId" TEXT,
ADD COLUMN     "forkedFromRecipeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "recipe_forkedFromAttemptId_key" ON "recipe"("forkedFromAttemptId");

-- CreateIndex
CREATE INDEX "recipe_forkedFromRecipeId_idx" ON "recipe"("forkedFromRecipeId");

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_forkedFromRecipeId_fkey" FOREIGN KEY ("forkedFromRecipeId") REFERENCES "recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_forkedFromAttemptId_fkey" FOREIGN KEY ("forkedFromAttemptId") REFERENCES "attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

