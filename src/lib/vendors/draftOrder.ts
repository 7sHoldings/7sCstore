import "server-only";
import { prisma } from "../db";
import { buildReorder, type ReorderOptions } from "./reorder";

/**
 * Turn the engine's suggestion into a draft order the owner can edit.
 *
 * One open draft per vendor at a time: regenerating replaces the existing draft
 * rather than stacking duplicates, so a Monday job that runs twice is harmless.
 * Orders already marked placed are never touched.
 */
export async function generateDraftOrder(
  locationId: string,
  opts: ReorderOptions = {}
): Promise<{ purchaseOrderId: string | null; lines: number; totalCost: number; notes: string[] }> {
  const vendor = opts.vendor ?? "GSC";
  const result = await buildReorder(locationId, opts);

  if (result.lines.length === 0) {
    return { purchaseOrderId: null, lines: 0, totalCost: 0, notes: result.notes };
  }

  const po = await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.deleteMany({ where: { locationId, vendor, status: "DRAFT" } });
    const created = await tx.purchaseOrder.create({
      data: { locationId, vendor, status: "DRAFT", coverWeeks: result.coverWeeks },
    });
    await tx.purchaseOrderLine.createMany({
      data: result.lines.map((l) => ({
        purchaseOrderId: created.id,
        upcNorm: l.upcNorm,
        sku: l.sku,
        description: l.description,
        department: l.department,
        unitsPerCase: l.unitsPerCase,
        caseCost: l.caseCost,
        weeklyUnits: l.weeklyUnits,
        suggestedCases: l.suggestedCases,
        cases: l.suggestedCases,
        basis: l.basis,
        soldInWindow: l.soldInWindow,
        windowDays: l.windowDays,
      })),
      skipDuplicates: true,
    });
    return created;
  });

  return {
    purchaseOrderId: po.id,
    lines: result.lines.length,
    totalCost: result.totalCost,
    notes: result.notes,
  };
}
