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
// Bulk update
// ---------------------------------------------------------------------------

const bulkSchema = z.object({
  // Comma-separated product ids, as posted by the price-book selection.
  ids: z.string().min(1, "Select at least one product."),
  mode: z.enum(["pct", "amount", "set"]),
  value: z.coerce.number().refine((n) => isFinite(n), "Enter a number."),
  rounding: z.enum(["none", "nickel", "dime", "end99"]).default("none"),
});

/**
 * Reprice many products at once: shift by a percentage or a dollar amount, or
 * set them all to one price, with an optional shelf-friendly rounding rule.
 */
export async function bulkUpdatePrices(
  _prev: PricingResult | undefined,
  formData: FormData
): Promise<PricingResult> {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };

  const parsed = bulkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  if (v.mode === "set" && v.value < 0) return { error: "Price can't be negative." };

  const ids = [...new Set(v.ids.split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return { error: "Select at least one product." };

  try {
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, locationId: auth.locationId },
      select: { id: true, name: true, sellingPrice: true },
    });
    if (products.length === 0) return { error: "No matching products at this location." };

    const changes = products
      .map((p) => ({
        id: p.id,
        name: p.name,
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

    revalidatePath("/pricing");
    revalidatePath("/inventory");
    return { ok: true, updated: changes.length };
  } catch (e) {
    console.error(e);
    return { error: "Could not apply the price change." };
  }
}
