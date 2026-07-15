"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { setCreditManual, addHouseAccount as addHA, addPayoutCategory as addPC, getHouseAccounts, getPayoutCategories, getPayoutTree, addPayoutParent, addPayoutSub, type HouseCharge, type PayoutTree } from "@/lib/credit";
import { uploadReceiptsFromForm } from "@/lib/storage";
import { setReceipts } from "@/lib/receipts";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { money } from "@/lib/calc";

/**
 * Marker note that ties an Expense row to the day's Credit Entry payouts, so
 * re-saving the day replaces the mirrored rows instead of duplicating them.
 */
const PAYOUT_EXPENSE_NOTE = "Payout in Cash (Credit Entry)";

/**
 * Mirror a day's cash payouts into the Expense table so they show up in
 * Expenses (and the P&L). "Product Buying · X" becomes an Inventory Purchase
 * from X; everything else becomes a Store Operating Expense. Paid in cash.
 */
async function syncPayoutExpenses(locationId: string, dateISO: string, payouts: HouseCharge[], userId: string): Promise<void> {
  const dayStart = new Date(dateISO);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  await prisma.expense.deleteMany({
    where: { locationId, date: { gte: dayStart, lt: dayEnd }, note: PAYOUT_EXPENSE_NOTE },
  });
  for (const p of payouts) {
    const [parent, sub] = p.account.split(" · ").map((s) => s.trim());
    const isProductBuying = (parent ?? "").toLowerCase().includes("product buying");
    await prisma.expense.create({
      data: {
        date: dayStart,
        locationId,
        category: isProductBuying ? "INVENTORY_PURCHASE" : "STORE_OPERATING_EXPENSES",
        amount: money(p.amount),
        payee: sub || parent || p.account,
        paymentMethod: "CASH",
        note: PAYOUT_EXPENSE_NOTE,
        source: "MANUAL",
        enteredById: userId,
      },
    });
  }
}

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

/** Add a top-level payout category (parent) inline; returns the updated tree. */
export async function addPayoutParentInline(name: string): Promise<PayoutTree> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return getPayoutTree();
  return name.trim() ? addPayoutParent(name) : getPayoutTree();
}

/** Add a sub-category under a parent inline; returns the updated tree. */
export async function addPayoutSubInline(parent: string, name: string): Promise<PayoutTree> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return getPayoutTree();
  return parent.trim() && name.trim() ? addPayoutSub(parent, name) : getPayoutTree();
}

/** Pair up parallel select+amount fields into positive line items. */
function readLines(formData: FormData, nameField: string, amountField: string): HouseCharge[] {
  const names = formData.getAll(nameField).map((v) => String(v).trim());
  const amounts = formData.getAll(amountField).map((v) => Number(v));
  return names
    .map((account, i) => ({ account, amount: isFinite(amounts[i]) && amounts[i] > 0 ? amounts[i] : 0 }))
    .filter((h) => h.account && h.amount > 0);
}

/** Read parent+sub payout rows into line items (account = "Parent · Sub"). */
function readPayouts(formData: FormData): HouseCharge[] {
  const parents = formData.getAll("payoutParent").map((v) => String(v).trim());
  const subs = formData.getAll("payoutSub").map((v) => String(v).trim());
  const amounts = formData.getAll("payoutAmount").map((v) => Number(v));
  return parents
    .map((parent, i) => {
      const sub = subs[i] ?? "";
      const account = parent && sub ? `${parent} · ${sub}` : parent;
      const amount = isFinite(amounts[i]) && amounts[i] > 0 ? amounts[i] : 0;
      return { account, amount };
    })
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
  const payouts = readPayouts(formData);

  const data = { ebt: num("ebt"), otherCredit: num("otherCredit"), payouts, house };
  await setCreditManual(loc, date, data);
  await syncPayoutExpenses(loc, date, payouts, session.userId);

  // New photos replace the day's receipts (so an update doesn't keep the old image).
  const photos = await uploadReceiptsFromForm(formData, "photos", `${loc}/credit/${date}`);
  if (photos.length) await setReceipts(loc, "credit", date, photos);

  await logAudit({ userId: session.userId, action: "UPDATE", entity: "Setting", entityId: `creditmanual:${loc}:${date}`, after: data });

  revalidatePath("/credit-entry");
  revalidatePath("/daily");
  revalidatePath("/dashboard");
  revalidatePath("/expenses");
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
