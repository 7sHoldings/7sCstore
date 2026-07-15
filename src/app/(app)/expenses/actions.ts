"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { money } from "@/lib/calc";
import { getCreditManual, setCreditManual } from "@/lib/credit";
import { toISODate } from "@/lib/period";

/** Marker linking a mirrored expense to the day's Credit Entry payout line. */
const PAYOUT_NOTE = "Payout in Cash (Credit Entry)";

type ExpenseRecord = { date: Date; amount: number; payee: string | null; note: string | null };

/**
 * Keep Credit Entry in sync when a mirrored payout-expense is edited or
 * deleted: find the matching payout line (by payee + amount) on that day and
 * update / move / remove it. Pass after=null for a deletion.
 */
async function syncExpenseEditToPayout(
  locationId: string,
  before: ExpenseRecord,
  after: { date: Date; amount: number; payee: string | null } | null
): Promise<void> {
  if (before.note !== PAYOUT_NOTE) return;
  const dateISO = toISODate(before.date);
  const day = await getCreditManual(locationId, dateISO);
  if (!day) return;

  const idx = day.payouts.findIndex((p) => {
    const [parent, sub] = p.account.split(" · ").map((s) => s.trim());
    return (sub || parent) === (before.payee ?? "") && Math.abs(p.amount - before.amount) < 0.005;
  });
  if (idx === -1) return;
  const line = day.payouts[idx];
  const [parent] = line.account.split(" · ").map((s) => s.trim());

  if (!after) {
    day.payouts.splice(idx, 1);
    await setCreditManual(locationId, dateISO, day);
    return;
  }

  const newSub = (after.payee ?? "").trim() || (before.payee ?? "");
  const newAccount = line.account.includes(" · ") ? `${parent} · ${newSub}` : newSub;
  const newDateISO = toISODate(after.date);

  if (newDateISO === dateISO) {
    day.payouts[idx] = { account: newAccount, amount: money(after.amount) };
    await setCreditManual(locationId, dateISO, day);
  } else {
    // Moved to a different day: remove here, append to the target day's entry.
    day.payouts.splice(idx, 1);
    await setCreditManual(locationId, dateISO, day);
    const target = (await getCreditManual(locationId, newDateISO)) ?? { ebt: 0, otherCredit: 0, payouts: [], house: [] };
    target.payouts.push({ account: newAccount, amount: money(after.amount) });
    await setCreditManual(locationId, newDateISO, target);
  }
}

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

const updateSchema = schema.extend({ id: z.string().min(1) });

export async function updateExpense(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "editDelete")) return { error: "You don't have permission to edit." };

  const raw = Object.fromEntries(formData);
  const parsed = updateSchema.safeParse({ ...raw, recurring: formData.get("recurring") === "on" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  const before = await prisma.expense.findUnique({ where: { id: v.id } });
  if (!before) return { error: "Expense not found." };

  try {
    const exp = await prisma.expense.update({
      where: { id: v.id },
      data: {
        date: new Date(v.date),
        category: v.category,
        amount: money(v.amount),
        payee: v.payee,
        checkNo: v.checkNo || null,
        paymentMethod: v.paymentMethod,
        note: v.note,
        recurring: v.recurring,
      },
    });
    await logAudit({ userId: session.userId, action: "UPDATE", entity: "Expense", entityId: exp.id, before, after: exp });
    // Mirrored payout? Push the change back into the day's Credit Entry.
    await syncExpenseEditToPayout(before.locationId, before, { date: exp.date, amount: exp.amount, payee: exp.payee });
  } catch (e) {
    console.error(e);
    return { error: "Could not save changes." };
  }

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/daily");
  revalidatePath("/credit-entry");
  revalidatePath("/payouts");
  return { ok: true };
}

export async function deleteExpense(id: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "editDelete")) return;
  const before = await prisma.expense.findUnique({ where: { id } });
  await prisma.expense.delete({ where: { id } });
  await logAudit({ userId: session.userId, action: "DELETE", entity: "Expense", entityId: id, before });
  // Mirrored payout? Remove the matching line from the day's Credit Entry too.
  if (before) await syncExpenseEditToPayout(before.locationId, before, null);
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/daily");
  revalidatePath("/credit-entry");
  revalidatePath("/payouts");
}

// Add a custom option to a dropdown list ("Expense type" or "Vendor") so it
// persists and appears for future entries.
export async function addExpenseOption(
  kind: "EXPENSE_TYPE" | "VENDOR",
  rawValue: string
): Promise<{ ok?: boolean; error?: string; value?: string }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterExpenses")) return { error: "You don't have permission." };
  if (kind !== "EXPENSE_TYPE" && kind !== "VENDOR") return { error: "Invalid list." };

  const value = (rawValue ?? "").trim();
  if (!value) return { error: "Enter a name." };
  if (value.length > 80) return { error: "Name is too long." };

  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned to your account." };

  try {
    await prisma.expenseOption.create({ data: { locationId, kind, value } });
  } catch (e) {
    // Unique constraint (already exists) is fine — treat as success.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) {
      console.error(e);
      return { error: "Could not add the option." };
    }
  }

  revalidatePath("/expenses");
  return { ok: true, value };
}
