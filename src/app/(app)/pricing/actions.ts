"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { money } from "@/lib/calc";
import { applyBulkPrice, type BulkMode, type RoundRule } from "@/lib/pricing";
import { buildWhere, type PriceBookFilter } from "@/lib/pricebook/filter";

export interface PricingResult {
  error?: string;
  ok?: boolean;
  /** How many products actually changed price (bulk updates only). */
  updated?: number;
}

/** Anything that touches a price is a purchasing action (SRS §4.11). */
async function authorize() {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." as const };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission to change prices." as const };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." as const };
  return { session, locationId };
}

// ---------------------------------------------------------------------------
// Single product
// ---------------------------------------------------------------------------

const singleSchema = z.object({
  productId: z.string().min(1),
  currentCost: z.coerce.number().min(0, "Cost can't be negative."),
  sellingPrice: z.coerce.number().min(0, "Price can't be negative."),
});

/** Update one product's cost basis and shelf price. */
export async function updateProductPricing(
  _prev: PricingResult | undefined,
  formData: FormData
): Promise<PricingResult> {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };

  const parsed = singleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  try {
    // Scope the lookup to the active location so one store can't reprice another's.
    const before = await prisma.product.findFirst({
      where: { id: v.productId, locationId: auth.locationId },
    });
    if (!before) return { error: "Product not found at this location." };

    const after = await prisma.product.update({
      where: { id: before.id },
      data: { currentCost: money(v.currentCost), sellingPrice: money(v.sellingPrice) },
    });
    await logAudit({
      userId: auth.session.userId,
      action: "PRICE_UPDATE",
      entity: "Product",
      entityId: after.id,
      before: { currentCost: before.currentCost, sellingPrice: before.sellingPrice },
      after: { currentCost: after.currentCost, sellingPrice: after.sellingPrice },
    });
  } catch (e) {
    console.error(e);
    return { error: "Could not save the price." };
  }

  revalidatePath("/pricing");
  revalidatePath("/inventory");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Selecting a whole filter
// ---------------------------------------------------------------------------

/** Never hand the browser an unbounded id list. */
const MAX_SELECTION = 20000;

const filterSchema = z.object({
  q: z.string().max(200).optional(),
  dept: z.string().max(120).optional(),
  below: z.boolean().optional(),
  noCost: z.boolean().optional(),
  noPrice: z.boolean().optional(),
});

/**
 * Every product id matching the current filter, so "select all 6,330 matching"
 * works without paging through the table by hand.
 */
export async function matchingProductIds(
  filter: unknown
): Promise<{ error?: string; ids?: string[]; truncated?: boolean }> {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };

  const parsed = filterSchema.safeParse(filter ?? {});
  if (!parsed.success) return { error: "Invalid filter." };
  const f = parsed.data as PriceBookFilter;

  try {
    const rows = await prisma.product.findMany({
      where: buildWhere(auth.locationId, f),
      select: { id: true, sellingPrice: true, currentCost: true },
      orderBy: { name: "asc" },
      take: MAX_SELECTION + 1,
    });

    // price <= cost is a column-to-column comparison, applied here rather than
    // in SQL so it stays identical to the badge shown in the table.
    const filtered = f.below
      ? rows.filter((r) => r.sellingPrice > 0 && r.currentCost > 0 && r.sellingPrice <= r.currentCost)
      : rows;

    return {
      ids: filtered.slice(0, MAX_SELECTION).map((r) => r.id),
      truncated: filtered.length > MAX_SELECTION,
    };
  } catch (e) {
    console.error(e);
    return { error: "Could not read the product list." };
  }
}

// ---------------------------------------------------------------------------
// Bulk update
// ---------------------------------------------------------------------------

const batchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one product.").max(1000),
  mode: z.enum(["pct", "amount", "set"]),
  value: z.number().refine((n) => isFinite(n), "Enter a number."),
  rounding: z.enum(["none", "nickel", "dime", "end99"]).default("none"),
});

/**
 * Reprice one batch of products. The client sends batches so a change across a
 * whole department stays inside the request time limit and can show progress.
 */
export async function applyBulkPriceBatch(input: unknown): Promise<PricingResult> {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };

  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  if (v.mode === "set" && v.value < 0) return { error: "Price can't be negative." };

  try {
    const products = await prisma.product.findMany({
      where: { id: { in: v.ids }, locationId: auth.locationId },
      select: { id: true, sellingPrice: true },
    });
    if (products.length === 0) return { ok: true, updated: 0 };

    const changes = products
      .map((p) => ({
        id: p.id,
        from: p.sellingPrice,
        to: applyBulkPrice(p.sellingPrice, v.mode as BulkMode, v.value, v.rounding as RoundRule),
      }))
      .filter((c) => c.to !== c.from);

    if (changes.length === 0) return { ok: true, updated: 0 };

    await prisma.$transaction(
      changes.map((c) =>
        prisma.product.update({ where: { id: c.id }, data: { sellingPrice: c.to } })
      )
    );

    // One audit row per product so each item keeps its own price history (FR-46).
    // Kept out of the block above: the prices are already committed, so a failed
    // audit write must not report the repricing itself as failed.
    try {
      await prisma.auditLog.createMany({
        data: changes.map((c) => ({
          userId: auth.session.userId,
          action: "PRICE_UPDATE_BULK",
          entity: "Product",
          entityId: c.id,
          before: JSON.stringify({ sellingPrice: c.from }),
          after: JSON.stringify({ sellingPrice: c.to, mode: v.mode, value: v.value, rounding: v.rounding }),
        })),
      });
    } catch (e) {
      console.error("bulk price audit log failed", e);
    }

    return { ok: true, updated: changes.length };
  } catch (e) {
    console.error(e);
    return { error: "Could not apply the price change." };
  }
}

/** Refresh the price book once a multi-batch bulk change has finished. */
export async function finishBulkUpdate(): Promise<void> {
  revalidatePath("/pricing");
  revalidatePath("/inventory");
}
