"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { money } from "@/lib/calc";
import { diffProduct } from "@/lib/pricebook/merge";

/**
 * Apply one batch of parsed price-book rows.
 *
 * The client sends the file in batches so a 16k-row catalogue never runs into a
 * serverless time limit and the owner sees real progress.
 *
 * Two rules protect existing data, because a POS export routinely carries zeros
 * that mean "unknown" rather than "zero":
 *   - a zero *cost* never overwrites a real cost (cost is empty on ~99% of rows,
 *     and real cost comes from vendor invoices)
 *   - a zero *retail* never overwrites a real price (unpriced POS items)
 * Optional columns (size, units/case, item code) behave the same way: a blank
 * incoming value leaves whatever is already stored alone.
 */

const rowSchema = z.object({
  upc: z.string().min(1).max(64),
  name: z.string().min(1).max(300),
  department: z.string().max(120).nullable().optional(),
  category: z.enum(["FUEL", "STORE", "LOTTERY", "TOBACCO", "FOOD_DRINK", "OTHER"]),
  sellingPrice: z.coerce.number().min(0),
  currentCost: z.coerce.number().min(0),
  size: z.string().max(120).nullable().optional(),
  unitsPerCase: z.coerce.number().min(0).nullable().optional(),
  posItemCode: z.string().max(120).nullable().optional(),
});

const batchSchema = z.object({
  rows: z.array(rowSchema).min(1).max(2000),
});

export interface ApplyResult {
  error?: string;
  ok?: boolean;
  created?: number;
  updated?: number;
  unchanged?: number;
}

export async function applyPriceBookBatch(input: unknown): Promise<ApplyResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission to import a price book." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid batch." };
  const rows = parsed.data.rows;

  try {
    const upcs = rows.map((r) => r.upc);
    const existing = await prisma.product.findMany({
      where: { locationId, upc: { in: upcs } },
      select: {
        id: true, upc: true, name: true, category: true, department: true,
        size: true, unitsPerCase: true, posItemCode: true,
        sellingPrice: true, currentCost: true,
      },
    });
    const byUpc = new Map(existing.map((p) => [p.upc!, p]));

    const toCreate: {
      locationId: string; upc: string; name: string; category: typeof rows[number]["category"];
      department: string | null; size: string | null; unitsPerCase: number | undefined;
      posItemCode: string | null; sellingPrice: number; currentCost: number;
    }[] = [];
    const toUpdate: { id: string; data: Record<string, unknown> }[] = [];
    let unchanged = 0;

    for (const r of rows) {
      const price = money(r.sellingPrice);
      const cost = money(r.currentCost);
      const prev = byUpc.get(r.upc);

      if (!prev) {
        toCreate.push({
          locationId,
          upc: r.upc,
          name: r.name,
          category: r.category,
          department: r.department ?? null,
          size: r.size ?? null,
          unitsPerCase:
            r.unitsPerCase && r.unitsPerCase > 0 ? Math.round(r.unitsPerCase) : undefined,
          posItemCode: r.posItemCode ?? null,
          sellingPrice: price,
          currentCost: cost,
        });
        continue;
      }

      // Only carry over values the export actually knows.
      const next = diffProduct(prev, { ...r, department: r.department ?? null, size: r.size ?? null, unitsPerCase: r.unitsPerCase ?? null, posItemCode: r.posItemCode ?? null }, price, cost);

      if (Object.keys(next).length === 0) unchanged++;
      else toUpdate.push({ id: prev.id, data: next });
    }

    if (toCreate.length > 0) {
      // skipDuplicates guards the (locationId, upc) unique index if two batches race.
      await prisma.product.createMany({ data: toCreate, skipDuplicates: true });
    }
    if (toUpdate.length > 0) {
      await prisma.$transaction(
        toUpdate.map((u) => prisma.product.update({ where: { id: u.id }, data: u.data }))
      );
    }

    return { ok: true, created: toCreate.length, updated: toUpdate.length, unchanged };
  } catch (e) {
    console.error("price book batch failed", e);
    return { error: "Could not save this batch. Nothing in it was applied." };
  }
}

/** Record one audit entry for the whole import once every batch has landed. */
export async function finishPriceBookImport(summary: {
  fileName: string;
  created: number;
  updated: number;
  unchanged: number;
}): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "enterPurchases")) return;

  await logAudit({
    userId: session.userId,
    action: "PRICEBOOK_IMPORT",
    entity: "Product",
    after: {
      fileName: String(summary.fileName ?? "").slice(0, 200),
      created: Number(summary.created) || 0,
      updated: Number(summary.updated) || 0,
      unchanged: Number(summary.unchanged) || 0,
    },
  });

  revalidatePath("/pricing");
  revalidatePath("/inventory");
}
