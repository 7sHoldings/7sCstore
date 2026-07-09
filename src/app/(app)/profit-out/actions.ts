"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { money } from "@/lib/calc";

const schema = z.object({
  id: z.string().optional(),
  date: z.string().min(1, "Pick a date."),
  amount: z.coerce.number().positive("Enter an amount greater than 0."),
  note: z.string().optional(),
});

/** Create or update a profit-taken-out entry (owner draw). */
export async function saveProfitDraw(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "viewProfit")) return { error: "You don't have permission." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  try {
    if (v.id) {
      await prisma.profitDraw.update({
        where: { id: v.id },
        data: { date: new Date(v.date), amount: money(v.amount), note: v.note?.trim() || null },
      });
      await logAudit({ userId: session.userId, action: "UPDATE", entity: "ProfitDraw", entityId: v.id, after: v });
    } else {
      const rec = await prisma.profitDraw.create({
        data: { locationId, date: new Date(v.date), amount: money(v.amount), note: v.note?.trim() || null, source: "MANUAL", enteredById: session.userId },
      });
      await logAudit({ userId: session.userId, action: "CREATE", entity: "ProfitDraw", entityId: rec.id, after: rec });
    }
  } catch (e) {
    console.error(e);
    return { error: "Could not save the entry." };
  }
  revalidatePath("/profit-out");
  return { ok: true };
}

/** Delete a profit-taken-out entry. */
export async function deleteProfitDraw(id: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "viewProfit")) return;
  const before = await prisma.profitDraw.findUnique({ where: { id } });
  if (!before) return;
  await prisma.profitDraw.delete({ where: { id } });
  await logAudit({ userId: session.userId, action: "DELETE", entity: "ProfitDraw", entityId: id, before });
  revalidatePath("/profit-out");
}
