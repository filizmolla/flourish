-- AlterTable
-- Who the recipe is from ("@account", "Mom"); existing recipes have none.
ALTER TABLE "recipe" ADD COLUMN     "source" TEXT;
