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
  date: z.string().min(1),
  rent: z.coerce.number().min(0).default(0),
  gameMachine: z.coerce.number().min(0).default(0),
  stagityInvestment: z.coerce.number().min(0).default(0),
  beer: z.coerce.number().min(0).default(0),
});

export async function createMoneyIncoming(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission." };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const total = money(v.rent + v.gameMachine + v.stagityInvestment + v.beer);
  try {
    const rec = await prisma.moneyIncoming.create({
      data: {
        date: new Date(v.date),
        locationId,
        rent: money(v.rent),
        gameMachine: money(v.gameMachine),
        stagityInvestment: money(v.stagityInvestment),
        beer: money(v.beer),
        total,
        source: "MANUAL",
      },
    });
    await logAudit({ userId: session.userId, action: "CREATE", entity: "MoneyIncoming", entityId: rec.id, after: rec });
  } catch (e) {
    console.error(e);
    return { error: "Could not save." };
  }
  revalidatePath("/money-incoming");
  return { ok: true };
}

const updateSchema = schema.extend({ id: z.string().min(1) });

export async function updateMoneyIncoming(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "editDelete")) return { error: "You don't have permission to edit." };
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  const before = await prisma.moneyIncoming.findUnique({ where: { id: v.id } });
  if (!before) return { error: "Entry not found." };

  const total = money(v.rent + v.gameMachine + v.stagityInvestment + v.beer);
  try {
    const rec = await prisma.moneyIncoming.update({
      where: { id: v.id },
      data: {
        date: new Date(v.date),
        rent: money(v.rent),
        gameMachine: money(v.gameMachine),
        stagityInvestment: money(v.stagityInvestment),
        beer: money(v.beer),
        total,
      },
    });
    await logAudit({ userId: session.userId, action: "UPDATE", entity: "MoneyIncoming", entityId: rec.id, before, after: rec });
  } catch (e) {
    console.error(e);
    return { error: "Could not save changes." };
  }
  revalidatePath("/money-incoming");
  return { ok: true };
}

export async function deleteMoneyIncoming(id: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "editDelete")) return;
  const before = await prisma.moneyIncoming.findUnique({ where: { id } });
  await prisma.moneyIncoming.delete({ where: { id } });
  await logAudit({ userId: session.userId, action: "DELETE", entity: "MoneyIncoming", entityId: id, before });
  revalidatePath("/money-incoming");
}
