-- 7sCstore — ordering & vendor-pricing tables
--
-- Run this in the Supabase SQL editor if the Weekly Order or GSC Pricing page
-- shows "a server-side exception has occurred". That error means the app was
-- deployed but these tables were never created.
--
-- SAFE TO RUN, AND SAFE TO RUN TWICE.
--   * only creates things — nothing is altered or dropped
--   * no existing data is read or touched
--   * every statement is guarded, so re-running it changes nothing
--
-- Verified by applying it to a copy of the previous schema, twice, and running
-- every query the Weekly Order page makes.

-- CreateTable
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

-- CreateTable
CREATE TABLE IF NOT EXISTS "DepartmentMargin" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "marginPct" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentMargin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductMovement" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "upcNorm" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "soldUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ProductMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VendorOrderLine_locationId_upcNorm_idx" ON "VendorOrderLine"("locationId", "upcNorm");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VendorOrderLine_locationId_vendor_orderSeq_idx" ON "VendorOrderLine"("locationId", "vendor", "orderSeq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VendorOrderLine_locationId_vendor_orderId_sku_key" ON "VendorOrderLine"("locationId", "vendor", "orderId", "sku");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DepartmentMargin_locationId_idx" ON "DepartmentMargin"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DepartmentMargin_locationId_department_key" ON "DepartmentMargin"("locationId", "department");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProductMovement_locationId_takenAt_idx" ON "ProductMovement"("locationId", "takenAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProductMovement_locationId_upcNorm_idx" ON "ProductMovement"("locationId", "upcNorm");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProductMovement_locationId_upcNorm_takenAt_key" ON "ProductMovement"("locationId", "upcNorm", "takenAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PurchaseOrder_locationId_vendor_status_idx" ON "PurchaseOrder"("locationId", "vendor", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PurchaseOrder_locationId_createdAt_idx" ON "PurchaseOrder"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrderLine_purchaseOrderId_upcNorm_key" ON "PurchaseOrderLine"("purchaseOrderId", "upcNorm");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProductDemand_locationId_periodStart_idx" ON "ProductDemand"("locationId", "periodStart");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProductDemand_locationId_upcNorm_idx" ON "ProductDemand"("locationId", "upcNorm");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProductDemand_locationId_upcNorm_periodStart_key" ON "ProductDemand"("locationId", "upcNorm", "periodStart");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseOrderLine_purchaseOrderId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

