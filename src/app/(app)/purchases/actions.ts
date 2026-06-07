"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { money, perGallon } from "@/lib/calc";

const purchaseSchema = z.object({
  date: z.string().min(1),
  vendorId: z.string().optional(),
  invoiceNo: z.string().optional(),
  productName: z.string().min(1, "Product name is required."),
  qty: z.coerce.number().min(0),
  costEach: z.coerce.number().min(0),
  sellPrice: z.coerce.number().min(0).default(0),
  paid: z.coerce.boolean().default(false),
});

export async function createPurchase(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission to enter purchases." };
  if (!session.locationId) return { error: "No location assigned." };

  const parsed = purchaseSchema.safeParse({ ...Object.fromEntries(formData), paid: formData.get("paid") === "on" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;
  const total = money(v.qty * v.costEach);

  try {
    const p = await prisma.purchase.create({
      data: {
        locationId: session.locationId,
        vendorId: v.vendorId || null,
        invoiceNo: v.invoiceNo,
        date: new Date(v.date),
        productName: v.productName,
        qty: v.qty,
        costEach: money(v.costEach),
        total,
        sellPrice: money(v.sellPrice),
        paid: v.paid,
        enteredById: session.userId,
      },
    });
    // Unpaid purchase increases what we owe the vendor (FR-25).
    if (v.vendorId && !v.paid) {
      await prisma.vendor.update({
        where: { id: v.vendorId },
        data: { balanceOwed: { increment: total } },
      });
    }
    await logAudit({ userId: session.userId, action: "CREATE", entity: "Purchase", entityId: p.id, after: p });
  } catch (e) {
    console.error(e);
    return { error: "Could not save the purchase." };
  }

  revalidatePath("/purchases");
  revalidatePath("/vendors");
  return { ok: true };
}

const deliverySchema = z.object({
  date: z.string().min(1),
  vendorId: z.string().optional(),
  grade: z.enum(["REGULAR", "MID", "PREMIUM", "DIESEL"]),
  gallons: z.coerce.number().min(0),
  costPerGallon: z.coerce.number().min(0),
  taxPerGallon: z.coerce.number().min(0).default(0),
  invoiceNo: z.string().optional(),
});

export async function createFuelDelivery(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission." };
  if (!session.locationId) return { error: "No location assigned." };

  const parsed = deliverySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;
  const total = money(v.gallons * v.costPerGallon);

  try {
    const d = await prisma.fuelDelivery.create({
      data: {
        locationId: session.locationId,
        vendorId: v.vendorId || null,
        date: new Date(v.date),
        grade: v.grade,
        gallons: v.gallons,
        costPerGallon: perGallon(v.costPerGallon),
        taxPerGallon: perGallon(v.taxPerGallon),
        total,
        invoiceNo: v.invoiceNo,
      },
    });
    await logAudit({ userId: session.userId, action: "CREATE", entity: "FuelDelivery", entityId: d.id, after: d });
  } catch (e) {
    console.error(e);
    return { error: "Could not save the delivery." };
  }

  revalidatePath("/purchases");
  return { ok: true };
}

export async function deletePurchase(id: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "editDelete")) return;
  const before = await prisma.purchase.findUnique({ where: { id } });
  await prisma.purchase.delete({ where: { id } });
  if (before?.vendorId && !before.paid) {
    await prisma.vendor.update({ where: { id: before.vendorId }, data: { balanceOwed: { decrement: before.total } } });
  }
  await logAudit({ userId: session.userId, action: "DELETE", entity: "Purchase", entityId: id, before });
  revalidatePath("/purchases");
  revalidatePath("/vendors");
}

export async function deleteFuelDelivery(id: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "editDelete")) return;
  const before = await prisma.fuelDelivery.findUnique({ where: { id } });
  await prisma.fuelDelivery.delete({ where: { id } });
  await logAudit({ userId: session.userId, action: "DELETE", entity: "FuelDelivery", entityId: id, before });
  revalidatePath("/purchases");
}
