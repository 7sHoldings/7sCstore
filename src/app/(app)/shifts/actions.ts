"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { shiftReconciliation } from "@/lib/calc";

const schema = z.object({
  date: z.string().min(1),
  userId: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  openCash: z.coerce.number().min(0).default(0),
  cashSales: z.coerce.number().min(0).default(0),
  payouts: z.coerce.number().min(0).default(0),
  cashDrop: z.coerce.number().min(0).default(0),
  closeCash: z.coerce.number().min(0).default(0),
  note: z.string().optional(),
});

export async function createShift(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission to record shifts." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  const { expectedCash, variance } = shiftReconciliation({
    cashSales: v.cashSales,
    payouts: v.payouts,
    cashDrop: v.cashDrop,
    openCash: v.openCash,
    closeCash: v.closeCash,
  });

  const dayBase = v.date;
  const toDateTime = (t?: string) => (t ? new Date(`${dayBase}T${t}`) : null);

  try {
    const shift = await prisma.shift.create({
      data: {
        locationId,
        date: new Date(v.date),
        userId: v.userId || null,
        startTime: toDateTime(v.startTime),
        endTime: toDateTime(v.endTime),
        openCash: v.openCash,
        closeCash: v.closeCash,
        expectedCash,
        variance,
        cashDrop: v.cashDrop,
        note: v.note,
      },
    });
    await logAudit({ userId: session.userId, action: "CREATE", entity: "Shift", entityId: shift.id, after: shift });

    // Flag a material cash discrepancy (FR-16).
    if (Math.abs(variance) >= 5) {
      await prisma.alert.create({
        data: {
          locationId,
          type: "CASH_VARIANCE",
          severity: variance < 0 ? "warning" : "info",
          message: `Shift on ${v.date} had a cash ${variance < 0 ? "shortage" : "overage"} of $${Math.abs(variance).toFixed(2)}.`,
        },
      });
    }
  } catch (e) {
    console.error(e);
    return { error: "Could not save the shift." };
  }

  revalidatePath("/shifts");
  return { ok: true };
}

export async function deleteShift(id: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "editDelete")) return;
  const before = await prisma.shift.findUnique({ where: { id } });
  await prisma.shift.delete({ where: { id } });
  await logAudit({ userId: session.userId, action: "DELETE", entity: "Shift", entityId: id, before });
  revalidatePath("/shifts");
}
