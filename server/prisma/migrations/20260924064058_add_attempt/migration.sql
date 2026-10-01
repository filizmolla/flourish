-- CreateTable
CREATE TABLE "attempt" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "durationMinutes" INTEGER,
    "madeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rating" INTEGER,
    "notes" TEXT,
    "ingredients" JSONB,
    "instructions" TEXT,
    "basedOnAttemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attempt_recipeId_madeAt_idx" ON "attempt"("recipeId", "madeAt");

-- AddForeignKey
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_basedOnAttemptId_fkey" FOREIGN KEY ("basedOnAttemptId") REFERENCES "attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
