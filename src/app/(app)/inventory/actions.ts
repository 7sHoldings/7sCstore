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
