"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { money, perGallon } from "@/lib/calc";

const saleSchema = z.object({
  date: z.string().min(1),
  category: z.enum(["FUEL", "STORE", "LOTTERY", "TOBACCO", "FOOD_DRINK", "OTHER"]),
  paymentType: z.enum(["CASH", "CARD", "OTHER"]),
  amount: z.coerce.number().min(0),
  taxCollected: z.coerce.number().min(0).default(0),
  refund: z.coerce.number().min(0).default(0),
  note: z.string().optional(),
  // fuel-only
  grade: z.enum(["REGULAR", "MID", "PREMIUM", "DIESEL"]).optional(),
  gallons: z.coerce.number().min(0).optional(),
  pricePerGallon: z.coerce.number().min(0).optional(),
  taxPerGallon: z.coerce.number().min(0).optional(),
  costPerGallon: z.coerce.number().min(0).optional(),
});

export async function createSale(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission to enter sales." };

  const parsed = saleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const v = parsed.data;
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned to your account." };

  const date = new Date(v.date);

  try {
    if (v.category === "FUEL") {
      if (!v.grade || !v.gallons || !v.pricePerGallon) {
        return { error: "Fuel sales need grade, gallons, and price per gallon." };
      }
      // If cost not supplied, default to the latest delivery cost for that grade.
      let cost = v.costPerGallon ?? 0;
      if (!cost) {
        const lastDelivery = await prisma.fuelDelivery.findFirst({
          where: { locationId, grade: v.grade },
          orderBy: { date: "desc" },
        });
        cost = lastDelivery?.costPerGallon ?? 0;
      }
      const total = money(v.gallons * v.pricePerGallon);
      const sale = await prisma.sale.create({
        data: {
          date,
          locationId,
          category: "FUEL",
          paymentType: v.paymentType,
          amount: total,
          taxCollected: 0,
          refund: money(v.refund),
          note: v.note,
          enteredById: session.userId,
          fuelSale: {
            create: {
              date,
              locationId,
              grade: v.grade,
              gallons: v.gallons,
              pricePerGallon: perGallon(v.pricePerGallon),
              total,
              taxPerGallon: perGallon(v.taxPerGallon ?? 0),
              costPerGallon: perGallon(cost),
            },
          },
        },
      });
      await logAudit({ userId: session.userId, action: "CREATE", entity: "Sale", entityId: sale.id, after: sale });
    } else {
      const sale = await prisma.sale.create({
        data: {
          date,
          locationId,
          category: v.category,
          paymentType: v.paymentType,
          amount: money(v.amount),
          taxCollected: money(v.taxCollected),
          refund: money(v.refund),
          note: v.note,
          enteredById: session.userId,
        },
      });
      await logAudit({ userId: session.userId, action: "CREATE", entity: "Sale", entityId: sale.id, after: sale });
    }
  } catch (e) {
    console.error(e);
    return { error: "Could not save the sale. Please try again." };
  }

  revalidatePath("/sales");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteSale(id: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "editDelete")) return;
  const before = await prisma.sale.findUnique({ where: { id } });
  await prisma.sale.delete({ where: { id } });
  await logAudit({ userId: session.userId, action: "DELETE", entity: "Sale", entityId: id, before });
  revalidatePath("/sales");
  revalidatePath("/dashboard");
}
