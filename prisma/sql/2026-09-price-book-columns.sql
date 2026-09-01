-- Price book columns on Product (merge of claude/pricing-system-nmb15k).
--
-- The Vercel deploy runs `prisma db push`, which should apply all of this on
-- its own. It is deliberately allowed to fail without failing the build, so
-- run this in the Supabase SQL editor if /pricing errors with a missing
-- column. Every statement is idempotent — running it twice changes nothing.
--
-- Adds two nullable columns and one with a default, plus two lookup indexes.
-- Nothing is dropped, renamed or rewritten, and no existing row changes.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "size"        TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "posItemCode" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The price book looks products up by scan code and lists them by POS
-- department. Created concurrently would be nicer on a hot table, but that
-- cannot run inside the transaction Supabase's editor wraps around this.
CREATE INDEX IF NOT EXISTS "Product_locationId_department_idx" ON "Product" ("locationId", "department");
CREATE INDEX IF NOT EXISTS "Product_upc_idx"                   ON "Product" ("upc");

-- Deliberately NOT added:
--   ALTER TABLE "Product" ADD CONSTRAINT ... UNIQUE ("locationId", "upc");
-- The branch declared that, but a unique constraint fails outright if the live
-- table already holds two products sharing a scan code, and a failed push here
-- is silent. The importer already dedupes by UPC in application code, so the
-- plain index above gives the same lookups without the risk. To adopt it later,
-- first check there is nothing to clean up:
--
--   SELECT "locationId", "upc", COUNT(*)
--   FROM "Product" WHERE "upc" IS NOT NULL
--   GROUP BY 1, 2 HAVING COUNT(*) > 1;
