"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { setCashManual, setCardManual } from "@/lib/cash";

function revalidateCash() {
  revalidatePath("/cash");
  revalidatePath("/daily");
  revalidatePath("/dashboard");
  revalidatePath("/monthly");
}

const setSchema = z.object({
  date: z.string().min(1, "Pick a date."),
  amount: z.coerce.number().min(0, "Amount can't be negative."),
});

/** Set (create or edit) the manual cash for a day. Used by the add form + edit modal. */
export async function setCashForDay(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission." };
  const loc = await getActiveLocationId();
  if (!loc) return { error: "No location assigned." };

  const parsed = setSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const dateISO = parsed.data.date.slice(0, 10);

  try {
    await setCashManual(loc, dateISO, parsed.data.amount);
    await logAudit({ userId: session.userId, action: "UPDATE", entity: "Setting", entityId: `cashmanual:${loc}:${dateISO}`, after: { amount: parsed.data.amount } });
    revalidateCash();
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { error: "Could not save the cash amount." };
  }
}

/** Clear the manual override for a day, reverting to the POS Safe Drop. */
export async function resetCashForDay(dateISO: string): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission." };
  const loc = await getActiveLocationId();
  if (!loc) return { error: "No location assigned." };

  try {
    await setCashManual(loc, dateISO.slice(0, 10), null);
    await logAudit({ userId: session.userId, action: "DELETE", entity: "Setting", entityId: `cashmanual:${loc}:${dateISO}` });
    revalidateCash();
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { error: "Could not reset the cash amount." };
  }
}

/** Set (create or edit) the manual card (Credit/Debit) total for a day. */
export async function setCardForDay(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission." };
  const loc = await getActiveLocationId();
  if (!loc) return { error: "No location assigned." };

  const parsed = setSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const dateISO = parsed.data.date.slice(0, 10);

  try {
    await setCardManual(loc, dateISO, parsed.data.amount);
    await logAudit({ userId: session.userId, action: "UPDATE", entity: "Setting", entityId: `cardmanual:${loc}:${dateISO}`, after: { amount: parsed.data.amount } });
    revalidateCash();
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { error: "Could not save the card amount." };
  }
}

/** Clear the manual card override for a day, reverting to the POS card batch. */
export async function resetCardForDay(dateISO: string): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission." };
  const loc = await getActiveLocationId();
  if (!loc) return { error: "No location assigned." };

  try {
    await setCardManual(loc, dateISO.slice(0, 10), null);
    await logAudit({ userId: session.userId, action: "DELETE", entity: "Setting", entityId: `cardmanual:${loc}:${dateISO}` });
    revalidateCash();
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { error: "Could not reset the card amount." };
  }
}
