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

/**
 * Refresh an open draft in place from the latest forecast.
 *
 * Used by the daily job so the order keeps up with the week's sales without
 * discarding work: every line's forecast is updated, and quantities follow the
 * new suggestion ONLY where the owner hasn't set one by hand. Newly qualifying
 * products are added; products that no longer qualify are dropped unless they
 * were edited, since an edit is a deliberate decision to order them.
 */
export async function refreshDraftOrder(
  locationId: string,
  opts: ReorderOptions = {}
): Promise<{ purchaseOrderId: string | null; updated: number; added: number; removed: number; kept: number }> {
  const vendor = opts.vendor ?? "GSC";
  const draft = await prisma.purchaseOrder.findFirst({
    where: { locationId, vendor, status: "DRAFT" },
    include: { lines: true },
  });

  // Nothing open yet — a fresh build is the right thing to do.
  if (!draft) {
    const built = await generateDraftOrder(locationId, opts);
    return { purchaseOrderId: built.purchaseOrderId, updated: 0, added: built.lines, removed: 0, kept: 0 };
  }

  const result = await buildReorder(locationId, { ...opts, coverWeeks: opts.coverWeeks ?? draft.coverWeeks });
  const suggested = new Map(result.lines.map((l) => [l.upcNorm, l]));
  const existing = new Map(draft.lines.map((l) => [l.upcNorm, l]));

  let updated = 0;
  let added = 0;
  let removed = 0;
  let kept = 0;

  const ops: Promise<unknown>[] = [];

  for (const [upcNorm, s] of suggested) {
    const prev = existing.get(upcNorm);
    if (!prev) {
      added++;
      continue;
    }
    updated++;
    ops.push(
      prisma.purchaseOrderLine.update({
        where: { id: prev.id },
        data: {
          weeklyUnits: s.weeklyUnits,
          suggestedCases: s.suggestedCases,
          caseCost: s.caseCost,
          unitsPerCase: s.unitsPerCase,
          basis: s.basis,
          soldInWindow: s.soldInWindow,
          windowDays: s.windowDays,
          // An edited quantity is the owner's decision and survives the refresh.
          ...(prev.edited ? {} : { cases: s.suggestedCases }),
        },
      }) as unknown as Promise<unknown>
    );
  }

  for (const [upcNorm, prev] of existing) {
    if (suggested.has(upcNorm)) continue;
    if (prev.edited) {
      kept++; // deliberately ordered despite the forecast — leave it alone
      continue;
    }
    removed++;
    ops.push(prisma.purchaseOrderLine.delete({ where: { id: prev.id } }) as unknown as Promise<unknown>);
  }

  const toAdd = [...suggested.values()].filter((s) => !existing.has(s.upcNorm));
  if (toAdd.length > 0) {
    ops.push(
      prisma.purchaseOrderLine.createMany({
        data: toAdd.map((l) => ({
          purchaseOrderId: draft.id,
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
      }) as unknown as Promise<unknown>
    );
  }

  await Promise.all(ops);
  await prisma.purchaseOrder.update({
    where: { id: draft.id },
    data: { refreshedAt: new Date() },
  });

  return { purchaseOrderId: draft.id, updated, added, removed, kept };
}
