-- CreateEnum
CREATE TYPE "Enjoyment" AS ENUM ('LOVED', 'FINE', 'NOT_WORTH_IT');

-- AlterTable
ALTER TABLE "attempt" ADD COLUMN     "enjoyment" "Enjoyment",
ADD COLUMN     "photoPath" TEXT;
