"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { addHousePayment, deleteHousePayment, updateHousePayment, updateHouseCharge } from "@/lib/credit";
import { uploadReceiptsFromForm } from "@/lib/storage";
import { todayISO } from "@/lib/day";
import { logAudit } from "@/lib/audit";

/** Record a payment against a house account (reduces its running balance). */
export async function recordHousePayment(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return;
  const loc = await getActiveLocationId();
  if (!loc) return;

  const account = String(formData.get("account") || "").trim();
  const amount = Number(formData.get("amount"));
  const date = String(formData.get("date") || "") || todayISO();
  const note = String(formData.get("note") || "");
  if (!account || !isFinite(amount) || amount <= 0) return;

  const [photo] = await uploadReceiptsFromForm(formData, "photos", `${loc}/housepay/${date}`);
  await addHousePayment(loc, account, amount, date, note, photo);
  await logAudit({ userId: session.userId, action: "CREATE", entity: "HousePayment", entityId: account, after: { account, amount, date } });
  revalidatePath("/house-accounts");
  revalidatePath("/daily");
  revalidatePath("/dashboard");
  redirect("/house-accounts?paid=1");
}

/** Edit a recorded payment (account / amount / date / note). */
export async function editHousePayment(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return { error: "You don't have permission." };
  const loc = await getActiveLocationId();
  if (!loc) return { error: "No location assigned." };

  const id = String(formData.get("id") || "");
  const account = String(formData.get("account") || "").trim();
  const amount = Number(formData.get("amount"));
  const date = String(formData.get("date") || "");
  const note = String(formData.get("note") || "");
  if (!id) return { error: "Missing entry." };
  if (!isFinite(amount) || amount <= 0) return { error: "Enter a valid amount." };

  const ok = await updateHousePayment(loc, id, { account, amount, date, note });
  if (!ok) return { error: "Payment not found." };
  await logAudit({ userId: session.userId, action: "UPDATE", entity: "HousePayment", entityId: id, after: { account, amount, date, note } });
  revalidatePath("/house-accounts");
  revalidatePath("/daily");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Edit a house charge line (comes from a day's Credit Entry). */
export async function editHouseCharge(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return { error: "You don't have permission." };
  const loc = await getActiveLocationId();
  if (!loc) return { error: "No location assigned." };

  const date = String(formData.get("origDate") || "");
  const account = String(formData.get("account") || "");
  const oldAmount = Number(formData.get("oldAmount"));
  const amount = Number(formData.get("amount"));
  const newDate = String(formData.get("date") || "") || undefined;
  if (!date || !account || !isFinite(oldAmount)) return { error: "Missing entry." };
  if (!isFinite(amount) || amount < 0) return { error: "Enter a valid amount." };

  const ok = await updateHouseCharge(loc, date, account, oldAmount, amount, newDate);
  if (!ok) return { error: "Charge not found — it may have been changed elsewhere." };
  await logAudit({
    userId: session.userId, action: "UPDATE", entity: "HouseCharge", entityId: `${account}:${date}`,
    before: { account, date, amount: oldAmount }, after: { account, date: newDate || date, amount },
  });
  revalidatePath("/house-accounts");
  revalidatePath("/credit-entry");
  revalidatePath("/daily");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Remove a recorded payment (e.g. entered in error). */
export async function removeHousePayment(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return;
  const loc = await getActiveLocationId();
  if (!loc) return;
  const id = String(formData.get("id") || "");
  if (!id) return;
  await deleteHousePayment(loc, id);
  revalidatePath("/house-accounts");
}
