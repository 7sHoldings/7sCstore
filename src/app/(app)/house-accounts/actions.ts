"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { addHousePayment, deleteHousePayment } from "@/lib/credit";
import { logAudit } from "@/lib/audit";

/** Record a payment against a house account (reduces its running balance). */
export async function recordHousePayment(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return;
  const loc = await getActiveLocationId();
  if (!loc) return;

  const account = String(formData.get("account") || "").trim();
  const amount = Number(formData.get("amount"));
  const date = String(formData.get("date") || "") || new Date().toISOString().slice(0, 10);
  const note = String(formData.get("note") || "");
  if (!account || !isFinite(amount) || amount <= 0) return;

  await addHousePayment(loc, account, amount, date, note);
  await logAudit({ userId: session.userId, action: "CREATE", entity: "HousePayment", entityId: account, after: { account, amount, date } });
  revalidatePath("/house-accounts");
  revalidatePath("/daily");
  revalidatePath("/dashboard");
  redirect("/house-accounts?paid=1");
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
