-- AlterTable
ALTER TABLE "attempt" ADD COLUMN     "tweaked" BOOLEAN NOT NULL DEFAULT false;

-- Existing rows: a snapshot can only have come from changes made while
-- cooking, because no recipe edit has filled one in yet (that starts with
-- this release). So this is exact for every row that exists today.
UPDATE "attempt" SET "tweaked" = ("ingredients" IS NOT NULL OR "instructions" IS NOT NULL);
