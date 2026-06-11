"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { setCreditManual, addHouseAccount as addHA, addPayoutCategory as addPC, getHouseAccounts, getPayoutCategories, type HouseCharge } from "@/lib/credit";
import { uploadReceiptsFromForm } from "@/lib/storage";
import { addReceipts } from "@/lib/receipts";
import { logAudit } from "@/lib/audit";

/** Add a payout category inline and return the updated list. */
export async function addPayoutCategoryInline(name: string): Promise<string[]> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return getPayoutCategories();
  if (name.trim()) await addPC(name);
  return getPayoutCategories();
}

/** Add a house account inline and return the updated list. */
export async function addHouseAccountInline(name: string): Promise<string[]> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return getHouseAccounts();
  if (name.trim()) await addHA(name);
  return getHouseAccounts();
}

/** Pair up parallel select+amount fields into positive line items. */
function readLines(formData: FormData, nameField: string, amountField: string): HouseCharge[] {
  const names = formData.getAll(nameField).map((v) => String(v).trim());
  const amounts = formData.getAll(amountField).map((v) => Number(v));
  return names
    .map((account, i) => ({ account, amount: isFinite(amounts[i]) && amounts[i] > 0 ? amounts[i] : 0 }))
    .filter((h) => h.account && h.amount > 0);
}

/** Save EBT / other credit / cash payouts / house-account charges for a day. */
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

  const house = readLines(formData, "houseAccount", "houseAmount");
  const payouts = readLines(formData, "payoutCategory", "payoutAmount");

  const data = { ebt: num("ebt"), otherCredit: num("otherCredit"), payouts, house };
  await setCreditManual(loc, date, data);

  const photos = await uploadReceiptsFromForm(formData, "photos", `${loc}/credit/${date}`);
  await addReceipts(loc, "credit", date, photos);

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

/** Add a new cash-payout category to the dropdown list. */
export async function addPayoutCategory(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return;
  const name = String(formData.get("name") || "");
  const date = String(formData.get("date") || "");
  if (!name.trim()) return;
  await addPC(name);
  revalidatePath("/credit-entry");
  const q = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `date=${date}&` : "";
  redirect(`/credit-entry?${q}addedp=${encodeURIComponent(name.trim())}`);
}
