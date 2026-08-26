-- Ordering & vendor-pricing tables.
--
-- Run this in the Supabase SQL editor when the Weekly Order or GSC Pricing
-- page shows "a server-side exception has occurred". That error means the
-- code was deployed but these tables were never created: scripts/db-deploy.mjs
-- runs 'prisma db push' on production deploys but deliberately never fails the
-- build, so a failed push ships the app against an older database.
--
-- Safe to run once. It only CREATEs new tables and adds one foreign key —
-- nothing existing is altered or dropped, and no data is touched.
-- Verified by applying it to a copy of the previous schema and running every
-- query the Weekly Order page makes.

-- CreateTable
CREATE TABLE "VendorOrderLine" (
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
CREATE TABLE "DepartmentMargin" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "marginPct" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentMargin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMovement" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "upcNorm" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "soldUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ProductMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
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
CREATE TABLE "PurchaseOrderLine" (
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
CREATE TABLE "ProductDemand" (
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
CREATE INDEX "VendorOrderLine_locationId_upcNorm_idx" ON "VendorOrderLine"("locationId", "upcNorm");

-- CreateIndex
CREATE INDEX "VendorOrderLine_locationId_vendor_orderSeq_idx" ON "VendorOrderLine"("locationId", "vendor", "orderSeq");

-- CreateIndex
CREATE UNIQUE INDEX "VendorOrderLine_locationId_vendor_orderId_sku_key" ON "VendorOrderLine"("locationId", "vendor", "orderId", "sku");

-- CreateIndex
CREATE INDEX "DepartmentMargin_locationId_idx" ON "DepartmentMargin"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentMargin_locationId_department_key" ON "DepartmentMargin"("locationId", "department");

-- CreateIndex
CREATE INDEX "ProductMovement_locationId_takenAt_idx" ON "ProductMovement"("locationId", "takenAt");

-- CreateIndex
CREATE INDEX "ProductMovement_locationId_upcNorm_idx" ON "ProductMovement"("locationId", "upcNorm");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMovement_locationId_upcNorm_takenAt_key" ON "ProductMovement"("locationId", "upcNorm", "takenAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_locationId_vendor_status_idx" ON "PurchaseOrder"("locationId", "vendor", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_locationId_createdAt_idx" ON "PurchaseOrder"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_purchaseOrderId_upcNorm_key" ON "PurchaseOrderLine"("purchaseOrderId", "upcNorm");

-- CreateIndex
CREATE INDEX "ProductDemand_locationId_periodStart_idx" ON "ProductDemand"("locationId", "periodStart");

-- CreateIndex
CREATE INDEX "ProductDemand_locationId_upcNorm_idx" ON "ProductDemand"("locationId", "upcNorm");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDemand_locationId_upcNorm_periodStart_key" ON "ProductDemand"("locationId", "upcNorm", "periodStart");

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

