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
  category: z.enum(["STORE_OPERATING_EXPENSES", "INVENTORY_PURCHASE"]),
  amount: z.coerce.number().min(0),
  payee: z.string().optional(),
  checkNo: z.string().optional(),
  paymentMethod: z.enum(["CASH", "CARD", "CHECK", "OTHER"]).default("CARD"),
  note: z.string().optional(),
  recurring: z.coerce.boolean().default(false),
});

export async function createExpense(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterExpenses")) return { error: "You don't have permission to enter expenses." };

  const raw = Object.fromEntries(formData);
  const parsed = schema.safeParse({ ...raw, recurring: formData.get("recurring") === "on" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned to your account." };

  try {
    const exp = await prisma.expense.create({
      data: {
        date: new Date(v.date),
        locationId,
        category: v.category,
        amount: money(v.amount),
        payee: v.payee,
        checkNo: v.checkNo || null,
        paymentMethod: v.paymentMethod,
        note: v.note,
        recurring: v.recurring,
        enteredById: session.userId,
      },
    });
    await logAudit({ userId: session.userId, action: "CREATE", entity: "Expense", entityId: exp.id, after: exp });
  } catch (e) {
    console.error(e);
    return { error: "Could not save the expense." };
  }

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteExpense(id: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "editDelete")) return;
  const before = await prisma.expense.findUnique({ where: { id } });
  await prisma.expense.delete({ where: { id } });
  await logAudit({ userId: session.userId, action: "DELETE", entity: "Expense", entityId: id, before });
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
}
