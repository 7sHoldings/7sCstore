"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { setCreditManual, addHouseAccount as addHA, type HouseCharge } from "@/lib/credit";
import { logAudit } from "@/lib/audit";

/** Save EBT / other credit / cash payout / house-account charges for a day. */
export async function saveCreditManual(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return;
  const loc = await getActiveLocationId();
  if (!loc) return;

  const date = String(formData.get("date") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  const num = (k: string) => {
    const n = Number(formData.get(k));
    return isFinite(n) && n >= 0 ? n : 0;
  };

  const accounts = formData.getAll("houseAccount").map((v) => String(v).trim());
  const amounts = formData.getAll("houseAmount").map((v) => Number(v));
  const house: HouseCharge[] = accounts
    .map((account, i) => ({ account, amount: isFinite(amounts[i]) && amounts[i] > 0 ? amounts[i] : 0 }))
    .filter((h) => h.account && h.amount > 0);

  const data = { ebt: num("ebt"), otherCredit: num("otherCredit"), payoutCash: num("payoutCash"), house };
  await setCreditManual(loc, date, data);
  await logAudit({ userId: session.userId, action: "UPDATE", entity: "Setting", entityId: `creditmanual:${loc}:${date}`, after: data });

  revalidatePath("/credit-entry");
  revalidatePath("/daily");
  revalidatePath("/dashboard");
  redirect(`/credit-entry?date=${date}&saved=1`);
}

/** Add a new house account to the dropdown list. */
export async function addHouseAccount(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return;
  const name = String(formData.get("name") || "");
  const date = String(formData.get("date") || "");
  if (!name.trim()) return;
  await addHA(name);
  revalidatePath("/credit-entry");
  const q = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `date=${date}&` : "";
  redirect(`/credit-entry?${q}added=${encodeURIComponent(name.trim())}`);
}
