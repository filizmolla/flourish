-- CreateEnum
CREATE TYPE "MealKind" AS ENUM ('MEAL', 'SNACK');

-- CreateEnum
CREATE TYPE "Fullness" AS ENUM ('STILL_HUNGRY', 'SATISFIED', 'VERY_FULL');

-- AlterTable
ALTER TABLE "attempt" ADD COLUMN     "fullness" "Fullness";

-- CreateTable
CREATE TABLE "meal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "MealKind" NOT NULL DEFAULT 'MEAL',
    "eatenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "text" TEXT,
    "nutrients" "Nutrient"[],
    "photoPath" TEXT,
    "fullness" "Fullness",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meal_userId_eatenAt_idx" ON "meal"("userId", "eatenAt");

-- AddForeignKey
ALTER TABLE "meal" ADD CONSTRAINT "meal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
