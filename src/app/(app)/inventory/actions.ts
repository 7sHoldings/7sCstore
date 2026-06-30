"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { money } from "@/lib/calc";
import { unitCostFromCase, priceFromMargin, defaultMargin } from "@/lib/pricing";
import { syncInventory, pushPrices } from "@/lib/integrations/sync";
import { fmtMoney } from "@/lib/format";

const readingSchema = z.object({
  date: z.string().min(1),
  grade: z.enum(["REGULAR", "MID", "PREMIUM", "DIESEL"]),
  gallonsBook: z.coerce.number().min(0),
  gallonsPhysical: z.coerce.number().min(0),
});

export async function recordFuelReading(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const parsed = readingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  try {
    const reading = await prisma.fuelInventory.create({
      data: {
        locationId,
        grade: v.grade,
        date: new Date(v.date),
        gallonsBook: v.gallonsBook,
        gallonsPhysical: v.gallonsPhysical,
        variance: money(v.gallonsPhysical - v.gallonsBook),
      },
    });
    await logAudit({ userId: session.userId, action: "CREATE", entity: "FuelInventory", entityId: reading.id, after: reading });
  } catch (e) {
    console.error(e);
    return { error: "Could not save the reading." };
  }
  revalidatePath("/inventory");
  return { ok: true };
}

const productSchema = z.object({
  name: z.string().min(1, "Name is required."),
  category: z.enum(["FUEL", "STORE", "LOTTERY", "TOBACCO", "FOOD_DRINK", "OTHER"]).default("STORE"),
  upc: z.string().optional(),
  vendorId: z.string().optional(),
  unitsPerCase: z.coerce.number().int().min(1).default(1),
  caseCost: z.coerce.number().min(0).default(0),
  marginPct: z.coerce.number().min(0).max(95).optional(),
  sellingPrice: z.coerce.number().min(0).default(0), // optional manual override
  qtyOnHand: z.coerce.number().min(0).default(0),
  lowThreshold: z.coerce.number().min(0).optional(),
  parLevel: z.coerce.number().min(0).optional(),
});

export async function createProduct(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  // Unit cost from the case, retail from the target margin (manual price wins).
  const unitCost = unitCostFromCase(v.caseCost, v.unitsPerCase);
  const margin = v.marginPct ?? defaultMargin(v.category);
  const sellingPrice = v.sellingPrice > 0 ? money(v.sellingPrice) : priceFromMargin(unitCost, margin);

  try {
    const product = await prisma.product.create({
      data: {
        locationId,
        name: v.name,
        category: v.category,
        upc: v.upc || null,
        vendorId: v.vendorId || null,
        unitsPerCase: v.unitsPerCase,
        caseCost: money(v.caseCost),
        currentCost: unitCost,
        marginPct: v.marginPct ?? null,
        sellingPrice,
        qtyOnHand: v.qtyOnHand,
        lowThreshold: v.lowThreshold,
        parLevel: v.parLevel,
      },
    });
    await logAudit({ userId: session.userId, action: "CREATE", entity: "Product", entityId: product.id, after: product });
  } catch (e) {
    console.error(e);
    return { error: "Could not save the product." };
  }
  revalidatePath("/inventory");
  return { ok: true };
}

const updateSchema = z.object({
  id: z.string().min(1),
  sellingPrice: z.coerce.number().min(0),
  caseCost: z.coerce.number().min(0).default(0),
  unitsPerCase: z.coerce.number().int().min(1).default(1),
  marginPct: z.coerce.number().min(0).max(95).optional(),
  vendorId: z.string().optional(),
  qtyOnHand: z.coerce.number().min(0).default(0),
  lowThreshold: z.coerce.number().min(0).optional(),
  parLevel: z.coerce.number().min(0).optional(),
});

/** Update an existing product's price, cost, stock and reorder settings. */
export async function updateProduct(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission." };

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;
  const unitCost = unitCostFromCase(v.caseCost, v.unitsPerCase);

  try {
    await prisma.product.update({
      where: { id: v.id },
      data: {
        sellingPrice: money(v.sellingPrice),
        caseCost: money(v.caseCost),
        currentCost: unitCost,
        unitsPerCase: v.unitsPerCase,
        marginPct: v.marginPct ?? null,
        vendorId: v.vendorId || null,
        qtyOnHand: v.qtyOnHand,
        lowThreshold: v.lowThreshold,
        parLevel: v.parLevel,
      },
    });
    await logAudit({ userId: session.userId, action: "UPDATE", entity: "Product", entityId: v.id, after: v });
  } catch (e) {
    console.error(e);
    return { error: "Could not update the product." };
  }
  revalidatePath("/inventory");
  return { ok: true };
}

/** Push one product's price to the POS (Modisoft). Mirrors the new price locally. */
export async function pushPriceToPos(
  productId: string,
  price: number
): Promise<{ ok?: boolean; error?: string; message?: string }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const product = await prisma.product.findFirst({
    where: { id: productId, locationId },
    select: { id: true, posItemId: true, posDeptId: true, name: true },
  });
  if (!product) return { error: "Product not found." };
  if (!product.posItemId) return { error: "This product isn't linked to the POS — pull inventory first." };
  if (!product.posDeptId) return { error: "No POS department mapped yet — pull inventory again, then retry." };

  const newPrice = money(price);
  if (!(newPrice > 0)) return { error: "Enter a valid retail price." };

  try {
    const { results } = await pushPrices(locationId, [
      { productId, posItemId: product.posItemId, posDeptId: product.posDeptId, newRetail: newPrice },
    ]);
    const r = results[0];
    await logAudit({ userId: session.userId, action: "UPDATE", entity: "Product", entityId: productId, after: { posPricePush: newPrice, ok: r?.ok, oldPrice: r?.oldPrice } });
    revalidatePath("/inventory");
    if (!r?.ok) return { error: r?.error ?? "Price push failed." };
    if (r.skipped) return { ok: true, message: `POS already at ${fmtMoney(newPrice)} — nothing to change.` };
    return { ok: true, message: `Pushed ${fmtMoney(r.oldPrice ?? 0)} → ${fmtMoney(newPrice)} to the POS.` };
  } catch (e) {
    console.error(e);
    return { error: e instanceof Error ? e.message : "Price push failed." };
  }
}

/**
 * Bulk-push every POS-linked product in the current view (department / category /
 * search filter) to the POS, using each product's app retail price. A department
 * or category filter is required so a full-catalog write can't happen by accident.
 */
export async function pushPricesToPos(filter: {
  q?: string;
  cat?: string;
  dept?: string;
}): Promise<{ ok?: boolean; error?: string; message?: string }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const cat = filter.cat?.trim() || "";
  const dept = filter.dept?.trim() || "";
  const q = filter.q?.trim() || "";
  if (!cat && !dept) {
    return { error: "Pick a department or category first — bulk push is scoped for safety." };
  }

  const where = {
    locationId,
    posItemId: { not: null },
    posDeptId: { not: null },
    ...(cat ? { category: cat as never } : {}),
    ...(dept ? { department: dept } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { upc: { contains: q } }] } : {}),
  };

  const products = await prisma.product.findMany({
    where,
    select: { id: true, posItemId: true, posDeptId: true, sellingPrice: true },
  });
  const items = products
    .filter((p) => p.posItemId && p.posDeptId && p.sellingPrice > 0)
    .map((p) => ({ productId: p.id, posItemId: p.posItemId!, posDeptId: p.posDeptId!, newRetail: p.sellingPrice }));
  if (!items.length) return { error: "No POS-linked products with a price in this view." };

  try {
    const { results } = await pushPrices(locationId, items);
    const ok = results.filter((r) => r.ok && !r.skipped).length;
    const skip = results.filter((r) => r.skipped).length;
    const fail = results.filter((r) => !r.ok).length;
    await logAudit({ userId: session.userId, action: "UPDATE", entity: "Product", after: { bulkPosPush: { scope: dept || cat, ok, skip, fail } } });
    revalidatePath("/inventory");
    return { ok: true, message: `Pushed ${ok} price${ok === 1 ? "" : "s"} to the POS · ${skip} already current · ${fail} failed (of ${items.length}).` };
  } catch (e) {
    console.error(e);
    return { error: e instanceof Error ? e.message : "Bulk price push failed." };
  }
}

/** Pull the current inventory from Modisoft (cookie session) and upsert Products. */
export async function pullInventoryFromModisoft(): Promise<{ ok?: boolean; error?: string; message?: string }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  try {
    const r = await syncInventory(locationId);
    await logAudit({ userId: session.userId, action: "IMPORT", entity: "Product", after: { created: r.created, updated: r.updated } });
    revalidatePath("/inventory");
    if (!r.live) {
      return { error: "No live Modisoft connection. Set MODI_COOKIE (or the official API key) in the app environment, then try again." };
    }
    return { ok: true, message: `Pulled ${r.total} items — ${r.created} new, ${r.updated} updated.` };
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Inventory pull failed.";
    return { error: msg };
  }
}
