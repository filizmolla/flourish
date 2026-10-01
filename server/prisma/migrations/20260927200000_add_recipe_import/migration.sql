-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'DONE', 'NO_RECIPE', 'FAILED');

-- AlterTable
ALTER TABLE "recipe" ADD COLUMN     "importId" TEXT,
ADD COLUMN     "importIndex" INTEGER;

-- CreateTable
CREATE TABLE "recipe_import" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "photoCount" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "durationMs" INTEGER,
    "error" TEXT,
    "result" JSONB,
    "reviewedCount" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_photo" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipe_import_userId_createdAt_idx" ON "recipe_import"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "import_photo_importId_position_key" ON "import_photo"("importId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_importId_importIndex_key" ON "recipe"("importId", "importIndex");

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_importId_fkey" FOREIGN KEY ("importId") REFERENCES "recipe_import"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_import" ADD CONSTRAINT "recipe_import_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_photo" ADD CONSTRAINT "import_photo_importId_fkey" FOREIGN KEY ("importId") REFERENCES "recipe_import"("id") ON DELETE CASCADE ON UPDATE CASCADE;

