-- 7sCstore — ordering & vendor-pricing tables
--
-- Run this in the Supabase SQL editor if the Weekly Order or GSC Pricing page
-- shows "a server-side exception has occurred".
--
-- SAFE TO RUN FROM ANY STATE, AND SAFE TO RUN TWICE.
--   * creates the tables if they are missing
--   * adds any columns missing from tables that already exist, which is the
--     case `prisma db push` cannot handle on its own: it refuses changes that
--     would drop a column, so a half-updated table is left behind
--   * no table outside this feature is read, altered or dropped
--
-- One deliberate deletion: ProductDemand rows are cleared when the table is
-- being upgraded from the older monthly layout to the weekly one. That table is
-- only a cache of sales figures pulled from the POS — press "Pull sales
-- history" on the Weekly Order page afterwards and it refills. No order,
-- pricing or store data is touched anywhere in this script.

-- ---------------------------------------------------------------------------
-- 1. Create anything that doesn't exist yet
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "VendorOrderLine" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT 'GSC',
    "orderId" TEXT NOT NULL,
    "orderSeq" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "upc" TEXT NOT NULL,
    "upcNorm" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitsPerCase" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sizeLabel" TEXT,
    "caseCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lineCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "srp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DepartmentMargin" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "marginPct" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DepartmentMargin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductMovement" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "upcNorm" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "soldUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "ProductMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT 'GSC',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "coverWeeks" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placedAt" TIMESTAMP(3),
    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "upcNorm" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "department" TEXT,
    "unitsPerCase" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "caseCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weeklyUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggestedCases" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cases" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "basis" TEXT NOT NULL DEFAULT 'measured',
    "soldInWindow" DOUBLE PRECISION,
    "windowDays" INTEGER,
    "weeklySeries" DOUBLE PRECISION[],
    "weeksWithSales" INTEGER,
    "typicalCases" DOUBLE PRECISION,
    "cappedByHistory" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductDemand" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "upcNorm" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodDays" INTEGER NOT NULL DEFAULT 7,
    "soldUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductDemand_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 2. Bring tables that already exist up to the current shape
-- ---------------------------------------------------------------------------

ALTER TABLE "PurchaseOrder"
  ADD COLUMN IF NOT EXISTS "coverWeeks" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "note" TEXT,
  ADD COLUMN IF NOT EXISTS "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "placedAt" TIMESTAMP(3);

ALTER TABLE "PurchaseOrderLine"
  ADD COLUMN IF NOT EXISTS "department" TEXT,
  ADD COLUMN IF NOT EXISTS "edited" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "basis" TEXT NOT NULL DEFAULT 'measured',
  ADD COLUMN IF NOT EXISTS "soldInWindow" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "windowDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "weeklySeries" DOUBLE PRECISION[],
  ADD COLUMN IF NOT EXISTS "weeksWithSales" INTEGER,
  ADD COLUMN IF NOT EXISTS "typicalCases" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "cappedByHistory" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "VendorOrderLine"
  ADD COLUMN IF NOT EXISTS "orderedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sizeLabel" TEXT;

-- ProductDemand moved from one monthly window to a series of weekly periods.
-- The old rows describe a window that no longer exists, and the table is only a
-- cache of POS figures, so they are cleared and the shape corrected.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ProductDemand' AND column_name = 'windowDays'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ProductDemand' AND column_name = 'periodStart'
  ) THEN
    DELETE FROM "ProductDemand";
    DROP INDEX IF EXISTS "ProductDemand_locationId_upcNorm_windowDays_key";
    DROP INDEX IF EXISTS "ProductDemand_locationId_windowDays_idx";
    ALTER TABLE "ProductDemand" DROP COLUMN IF EXISTS "windowDays";
  END IF;
END $$;

ALTER TABLE "ProductDemand"
  ADD COLUMN IF NOT EXISTS "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "periodDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- periodStart carries no default in the app; the one above only existed so the
-- column could be added to a table that already had rows.
ALTER TABLE "ProductDemand" ALTER COLUMN "periodStart" DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "VendorOrderLine_locationId_upcNorm_idx" ON "VendorOrderLine"("locationId", "upcNorm");
CREATE INDEX IF NOT EXISTS "VendorOrderLine_locationId_vendor_orderSeq_idx" ON "VendorOrderLine"("locationId", "vendor", "orderSeq");
CREATE UNIQUE INDEX IF NOT EXISTS "VendorOrderLine_locationId_vendor_orderId_sku_key" ON "VendorOrderLine"("locationId", "vendor", "orderId", "sku");
CREATE INDEX IF NOT EXISTS "DepartmentMargin_locationId_idx" ON "DepartmentMargin"("locationId");
CREATE UNIQUE INDEX IF NOT EXISTS "DepartmentMargin_locationId_department_key" ON "DepartmentMargin"("locationId", "department");
CREATE INDEX IF NOT EXISTS "ProductMovement_locationId_takenAt_idx" ON "ProductMovement"("locationId", "takenAt");
CREATE INDEX IF NOT EXISTS "ProductMovement_locationId_upcNorm_idx" ON "ProductMovement"("locationId", "upcNorm");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductMovement_locationId_upcNorm_takenAt_key" ON "ProductMovement"("locationId", "upcNorm", "takenAt");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_locationId_vendor_status_idx" ON "PurchaseOrder"("locationId", "vendor", "status");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_locationId_createdAt_idx" ON "PurchaseOrder"("locationId", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrderLine_purchaseOrderId_upcNorm_key" ON "PurchaseOrderLine"("purchaseOrderId", "upcNorm");
CREATE INDEX IF NOT EXISTS "ProductDemand_locationId_periodStart_idx" ON "ProductDemand"("locationId", "periodStart");
CREATE INDEX IF NOT EXISTS "ProductDemand_locationId_upcNorm_idx" ON "ProductDemand"("locationId", "upcNorm");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductDemand_locationId_upcNorm_periodStart_key" ON "ProductDemand"("locationId", "upcNorm", "periodStart");

-- ---------------------------------------------------------------------------
-- 4. Foreign key (Postgres has no IF NOT EXISTS for ADD CONSTRAINT)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseOrderLine_purchaseOrderId_fkey') THEN
    ALTER TABLE "PurchaseOrderLine"
      ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
