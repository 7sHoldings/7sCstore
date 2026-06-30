"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { parseCSV, SALES_TEMPLATE_HEADERS, EXPENSE_TEMPLATE_HEADERS, DAILY_SALES_TEMPLATE_HEADERS } from "@/lib/csv";
import { pushPrices } from "@/lib/integrations/sync";
import { money, perGallon } from "@/lib/calc";
import { unitCostFromCase } from "@/lib/pricing";
import { setLotteryManual } from "@/lib/lottery";
import { setCreditManual, getCreditManual, addHousePayment, deleteHousePayment, getHousePayments, addHouseAccount } from "@/lib/credit";

const HOUSE_IMPORT_TAG = "Imported (Excel)";

const CATEGORIES = ["FUEL", "STORE", "LOTTERY", "TOBACCO", "FOOD_DRINK", "OTHER"];
const PAYMENTS = ["CASH", "CARD", "OTHER"];
const GRADES = ["REGULAR", "MID", "PREMIUM", "DIESEL"];

const EXPENSE_CATEGORIES = ["STORE_OPERATING_EXPENSES", "INVENTORY_PURCHASE"];
const EXPENSE_PAYMENTS = ["CASH", "CARD", "CHECK", "OTHER"];

export interface ImportResult {
  ok?: boolean;
  imported?: number;
  message?: string; // optional rich summary (overrides the default success line)
  errors?: { row: number; message: string }[];
  error?: string;
}

interface ParsedRow {
  date: Date;
  category: string;
  paymentType: string;
  amount: number;
  taxCollected: number;
  grade?: string;
  gallons?: number;
  pricePerGallon?: number;
  note?: string;
}

/**
 * Validate-then-commit CSV import for sales (FR-40, NFR-8). The whole file is
 * validated first; if any row is invalid, nothing is saved and every error is
 * reported back so the user can fix the file.
 */
export async function importSales(
  _prev: ImportResult | undefined,
  formData: FormData
): Promise<ImportResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission to import sales." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a CSV file to import." };

  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return { error: "The file has no data rows." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  const missing = SALES_TEMPLATE_HEADERS.filter((h) => idx(h) === -1 && h !== "note");
  if (missing.length) {
    return { error: `Missing required columns: ${missing.join(", ")}. Download the template for the correct format.` };
  }

  const errors: { row: number; message: string }[] = [];
  const parsed: ParsedRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (name: string) => (idx(name) >= 0 ? (cells[idx(name)] ?? "").trim() : "");
    const lineNo = r + 1;

    const dateStr = get("date");
    const date = new Date(dateStr);
    if (!dateStr || isNaN(date.getTime())) {
      errors.push({ row: lineNo, message: `Invalid date "${dateStr}".` });
      continue;
    }
    const category = get("category").toUpperCase();
    if (!CATEGORIES.includes(category)) {
      errors.push({ row: lineNo, message: `Invalid category "${category}".` });
      continue;
    }
    const paymentType = (get("paymentType") || "CASH").toUpperCase();
    if (!PAYMENTS.includes(paymentType)) {
      errors.push({ row: lineNo, message: `Invalid payment type "${paymentType}".` });
      continue;
    }

    if (category === "FUEL") {
      const grade = get("grade").toUpperCase();
      const gallons = Number(get("gallons"));
      const price = Number(get("pricePerGallon"));
      if (!GRADES.includes(grade)) {
        errors.push({ row: lineNo, message: `Invalid fuel grade "${grade}".` });
        continue;
      }
      if (!(gallons > 0) || !(price > 0)) {
        errors.push({ row: lineNo, message: `Fuel rows need positive gallons and pricePerGallon.` });
        continue;
      }
      parsed.push({ date, category, paymentType, amount: money(gallons * price), taxCollected: 0, grade, gallons, pricePerGallon: price, note: get("note") });
    } else {
      const amount = Number(get("amount"));
      const tax = Number(get("taxCollected") || "0");
      if (!(amount >= 0) || isNaN(amount)) {
        errors.push({ row: lineNo, message: `Invalid amount "${get("amount")}".` });
        continue;
      }
      parsed.push({ date, category, paymentType, amount, taxCollected: isNaN(tax) ? 0 : tax, note: get("note") });
    }
  }

  if (errors.length) {
    return { ok: false, errors, imported: 0 };
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const p of parsed) {
        if (p.category === "FUEL") {
          const lastDelivery = await tx.fuelDelivery.findFirst({
            where: { locationId: locationId, grade: p.grade as never },
            orderBy: { date: "desc" },
          });
          await tx.sale.create({
            data: {
              date: p.date,
              locationId: locationId,
              category: "FUEL",
              paymentType: p.paymentType as never,
              amount: p.amount,
              taxCollected: 0,
              note: p.note,
              source: "CSV_IMPORT",
              enteredById: session.userId,
              fuelSale: {
                create: {
                  date: p.date,
                  locationId: locationId,
                  grade: p.grade as never,
                  gallons: p.gallons!,
                  pricePerGallon: perGallon(p.pricePerGallon!),
                  total: p.amount,
                  taxPerGallon: 0.184,
                  costPerGallon: perGallon(lastDelivery?.costPerGallon ?? 0),
                },
              },
            },
          });
        } else {
          await tx.sale.create({
            data: {
              date: p.date,
              locationId: locationId,
              category: p.category as never,
              paymentType: p.paymentType as never,
              amount: money(p.amount),
              taxCollected: money(p.taxCollected),
              note: p.note,
              source: "CSV_IMPORT",
              enteredById: session.userId,
            },
          });
        }
      }
    });
  } catch (e) {
    console.error(e);
    return { error: "Import failed while saving. No rows were imported." };
  }

  await logAudit({ userId: session.userId, action: "IMPORT", entity: "Sale", after: { count: parsed.length } });
  revalidatePath("/sales");
  revalidatePath("/dashboard");
  return { ok: true, imported: parsed.length };
}

interface ParsedExpense {
  date: Date;
  category: string;
  payee: string;
  amount: number;
  checkNo: string | null;
  paymentMethod: string;
  note: string | null;
}

/**
 * Validate-then-commit CSV import for expenses (Store Operating Expenses &
 * Inventory Purchases). The whole file is validated first; if any row is
 * invalid nothing is saved. Distinct payees are also added to the dropdown
 * option list so imported types/vendors show up for future manual entry.
 */
export async function importExpenses(
  _prev: ImportResult | undefined,
  formData: FormData
): Promise<ImportResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterExpenses")) return { error: "You don't have permission to import expenses." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a CSV file to import." };

  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return { error: "The file has no data rows." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  const required = ["date", "category", "payee", "amount"];
  const missing = required.filter((h) => idx(h) === -1);
  if (missing.length) {
    return { error: `Missing required columns: ${missing.join(", ")}. Download the template for the correct format.` };
  }

  const errors: { row: number; message: string }[] = [];
  const parsed: ParsedExpense[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (name: string) => (idx(name) >= 0 ? (cells[idx(name)] ?? "").trim() : "");
    const lineNo = r + 1;

    const dateStr = get("date");
    const date = new Date(dateStr);
    if (!dateStr || isNaN(date.getTime())) {
      errors.push({ row: lineNo, message: `Invalid date "${dateStr}".` });
      continue;
    }
    const category = get("category").toUpperCase();
    if (!EXPENSE_CATEGORIES.includes(category)) {
      errors.push({ row: lineNo, message: `Invalid category "${category}". Use STORE_OPERATING_EXPENSES or INVENTORY_PURCHASE.` });
      continue;
    }
    const payee = get("payee");
    if (!payee) {
      errors.push({ row: lineNo, message: `Missing payee (expense type or vendor).` });
      continue;
    }
    const amount = Number(get("amount"));
    if (isNaN(amount) || amount < 0) {
      errors.push({ row: lineNo, message: `Invalid amount "${get("amount")}".` });
      continue;
    }
    const paymentMethod = (get("paymentMethod") || "CASH").toUpperCase();
    if (!EXPENSE_PAYMENTS.includes(paymentMethod)) {
      errors.push({ row: lineNo, message: `Invalid payment method "${paymentMethod}".` });
      continue;
    }
    parsed.push({
      date,
      category,
      payee,
      amount: money(amount),
      checkNo: get("checkNo") || null,
      paymentMethod,
      note: get("note") || null,
    });
  }

  if (errors.length) {
    return { ok: false, errors, imported: 0 };
  }

  try {
    const dates = parsed.map((p) => p.date.getTime());
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates) + 86400000); // inclusive of the last day
    await prisma.$transaction(async (tx) => {
      // Idempotent re-import: clear previously CSV-imported expenses in this
      // date range so re-running doesn't create duplicates. Manually-entered
      // expenses (source MANUAL) are untouched.
      await tx.expense.deleteMany({
        where: { locationId, source: "CSV_IMPORT", date: { gte: minDate, lt: maxDate } },
      });
      for (const p of parsed) {
        await tx.expense.create({
          data: {
            date: p.date,
            locationId,
            category: p.category as never,
            amount: p.amount,
            payee: p.payee,
            checkNo: p.checkNo,
            paymentMethod: p.paymentMethod as never,
            note: p.note,
            source: "CSV_IMPORT",
            enteredById: session.userId,
          },
        });
      }
      // Add imported payees to the dropdown option lists (idempotent).
      const options = new Map<string, { locationId: string; kind: string; value: string }>();
      for (const p of parsed) {
        const kind = p.category === "INVENTORY_PURCHASE" ? "VENDOR" : "EXPENSE_TYPE";
        options.set(`${kind}::${p.payee.toLowerCase()}`, { locationId, kind, value: p.payee });
      }
      if (options.size) {
        await tx.expenseOption.createMany({ data: [...options.values()], skipDuplicates: true });
      }
    });
  } catch (e) {
    console.error(e);
    return { error: "Import failed while saving. No rows were imported." };
  }

  await logAudit({ userId: session.userId, action: "IMPORT", entity: "Expense", after: { count: parsed.length } });
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  return { ok: true, imported: parsed.length };
}

interface ParsedDailySales {
  date: Date;
  dailySales: number;
  fuel: number;
  lotto: number;
  lottery: number;
  lotteryPayout: number;
  total: number;
  credit: number;
  cash: number;
  shortOver: number;
}

/**
 * Validate-then-commit CSV import for per-day sales summaries (the legacy Excel
 * "daily sheet"). One row per day; figures are stored verbatim and shown by the
 * Monthly Sales view. Re-importing a date overwrites it.
 */
export async function importDailySales(
  _prev: ImportResult | undefined,
  formData: FormData
): Promise<ImportResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission to import sales." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a CSV file to import." };

  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return { error: "The file has no data rows." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  const missing = DAILY_SALES_TEMPLATE_HEADERS.filter((h) => idx(h) === -1 && h !== "lotto" && h !== "lottery" && h !== "lotteryPayout" && h !== "shortOver");
  if (missing.length) {
    return { error: `Missing required columns: ${missing.join(", ")}. Download the template for the correct format.` };
  }

  const errors: { row: number; message: string }[] = [];
  const parsed: ParsedDailySales[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (name: string) => (idx(name) >= 0 ? (cells[idx(name)] ?? "").trim() : "");
    const lineNo = r + 1;

    const dateStr = get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      errors.push({ row: lineNo, message: `Invalid date "${dateStr}" (use YYYY-MM-DD).` });
      continue;
    }
    const numField = (name: string) => {
      const raw = get(name);
      return raw === "" ? 0 : Number(raw);
    };
    const fields = ["dailySales", "fuel", "lotto", "lottery", "lotteryPayout", "total", "credit", "cash", "shortOver"];
    const vals: Record<string, number> = {};
    let bad = false;
    for (const f of fields) {
      const n = numField(f);
      if (isNaN(n)) { errors.push({ row: lineNo, message: `Invalid number in "${f}": "${get(f)}".` }); bad = true; break; }
      vals[f] = money(n);
    }
    if (bad) continue;

    parsed.push({
      date: new Date(`${dateStr}T00:00:00.000Z`),
      dailySales: vals.dailySales, fuel: vals.fuel, lotto: vals.lotto, lottery: vals.lottery,
      lotteryPayout: vals.lotteryPayout, total: vals.total, credit: vals.credit, cash: vals.cash, shortOver: vals.shortOver,
    });
  }

  if (errors.length) return { ok: false, errors, imported: 0 };

  try {
    await prisma.$transaction(
      parsed.map((p) =>
        prisma.dailySalesSummary.upsert({
          where: { locationId_date: { locationId, date: p.date } },
          create: { locationId, ...p },
          update: { ...p },
        })
      )
    );
  } catch (e) {
    console.error(e);
    return { error: "Import failed while saving. No rows were imported." };
  }

  await logAudit({ userId: session.userId, action: "IMPORT", entity: "DailySalesSummary", after: { count: parsed.length } });
  revalidatePath("/monthly");
  revalidatePath("/dashboard");
  return { ok: true, imported: parsed.length };
}

interface ParsedRecon {
  date: string;
  lotterySales: number;
  lotteryPayout: number;
  ebt: number;
  otherCredit: number;
  payoutCash: number;
  houseAccount: number;
}

/**
 * Validate-then-commit CSV import for the employee manual entries that drive the
 * daily Short/Over: lottery (sales/payout) and credit (EBT, other credit, cash
 * payout, house account). Written via the same save functions as the Lottery /
 * Credit Entry pages, so an imported day is identical to a hand-entered one.
 * Re-importing a date overwrites it; the base POS sales/tender are untouched.
 */
export async function importDailyReconciliation(
  _prev: ImportResult | undefined,
  formData: FormData
): Promise<ImportResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission to import sales." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a CSV file to import." };

  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return { error: "The file has no data rows." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  if (idx("date") === -1) return { error: `Missing required column: date. Download the template for the correct format.` };

  const errors: { row: number; message: string }[] = [];
  const parsed: ParsedRecon[] = [];
  const fields = ["lotterySales", "lotteryPayout", "ebt", "otherCredit", "payoutCash", "houseAccount"];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (name: string) => (idx(name) >= 0 ? (cells[idx(name)] ?? "").trim() : "");
    const lineNo = r + 1;
    const dateStr = get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      errors.push({ row: lineNo, message: `Invalid date "${dateStr}" (use YYYY-MM-DD).` });
      continue;
    }
    const vals: Record<string, number> = {};
    let bad = false;
    for (const f of fields) {
      const raw = get(f);
      const n = raw === "" ? 0 : Number(raw);
      if (isNaN(n) || n < 0) { errors.push({ row: lineNo, message: `Invalid "${f}": "${raw}".` }); bad = true; break; }
      vals[f] = money(n);
    }
    if (bad) continue;
    parsed.push({ date: dateStr, ...(vals as unknown as Omit<ParsedRecon, "date">) });
  }

  if (errors.length) return { ok: false, errors, imported: 0 };

  try {
    // Write in small batches to stay within the connection pool.
    for (let i = 0; i < parsed.length; i += 15) {
      const batch = parsed.slice(i, i + 15);
      await Promise.all(
        batch.map(async (p) => {
          if (p.lotterySales > 0 || p.lotteryPayout > 0) {
            await setLotteryManual(locationId, p.date, p.lotterySales, p.lotteryPayout);
          }
          if (p.ebt > 0 || p.otherCredit > 0 || p.payoutCash > 0 || p.houseAccount > 0) {
            await setCreditManual(locationId, p.date, {
              ebt: p.ebt,
              otherCredit: p.otherCredit,
              payouts: p.payoutCash > 0 ? [{ account: "General Payout", amount: p.payoutCash }] : [],
              house: p.houseAccount > 0 ? [{ account: "House Account", amount: p.houseAccount }] : [],
            });
          }
        })
      );
    }
  } catch (e) {
    console.error(e);
    return { error: "Import failed while saving. Some days may have been written; re-running is safe." };
  }

  await logAudit({ userId: session.userId, action: "IMPORT", entity: "Setting", after: { count: parsed.length, kind: "reconciliation" } });
  revalidatePath("/daily");
  revalidatePath("/monthly");
  revalidatePath("/lottery");
  revalidatePath("/credit-entry");
  return { ok: true, imported: parsed.length };
}

/**
 * Validate-then-commit CSV import for house accounts (charge = money charged to
 * the account, payback = money paid back). Charges are written into each day's
 * credit entry (per account), so they show on the House Accounts page AND keep
 * the Daily Short/Over correct (they replace that day's lump house total with the
 * same itemised amount). Paybacks become house payments. Other credit-entry
 * fields (EBT, payouts) on each day are preserved. Run AFTER the reconciliation
 * import.
 */
export async function importHouseAccounts(
  _prev: ImportResult | undefined,
  formData: FormData
): Promise<ImportResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission to import." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a CSV file to import." };

  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return { error: "The file has no data rows." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  for (const req of ["date", "account"]) {
    if (idx(req) === -1) return { error: `Missing required column: ${req}. Download the template for the correct format.` };
  }

  const errors: { row: number; message: string }[] = [];
  const chargesByDate = new Map<string, { account: string; amount: number }[]>();
  const payments: { date: string; account: string; amount: number }[] = [];
  const accountNames = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (name: string) => (idx(name) >= 0 ? (cells[idx(name)] ?? "").trim() : "");
    const lineNo = r + 1;
    const date = get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push({ row: lineNo, message: `Invalid date "${date}".` }); continue; }
    const account = get("account");
    if (!account) { errors.push({ row: lineNo, message: `Missing account name.` }); continue; }
    const charge = get("charge") === "" ? 0 : Number(get("charge"));
    const payback = get("payback") === "" ? 0 : Number(get("payback"));
    if (isNaN(charge) || charge < 0 || isNaN(payback) || payback < 0) {
      errors.push({ row: lineNo, message: `Invalid charge/payback on row ${lineNo}.` });
      continue;
    }
    accountNames.add(account);
    if (charge > 0) {
      const list = chargesByDate.get(date) ?? chargesByDate.set(date, []).get(date)!;
      list.push({ account, amount: money(charge) });
    }
    if (payback > 0) payments.push({ date, account, amount: money(payback) });
  }

  if (errors.length) return { ok: false, errors, imported: 0 };

  try {
    // Maintained account-name list (sequential — single shared setting).
    for (const name of accountNames) await addHouseAccount(name);

    // House charges → each day's credit entry, preserving EBT/payouts.
    const dates = [...chargesByDate.keys()];
    for (let i = 0; i < dates.length; i += 15) {
      await Promise.all(
        dates.slice(i, i + 15).map(async (date) => {
          const existing = await getCreditManual(locationId, date);
          await setCreditManual(locationId, date, {
            ebt: existing?.ebt ?? 0,
            otherCredit: existing?.otherCredit ?? 0,
            payouts: existing?.payouts ?? [],
            house: chargesByDate.get(date)!,
          });
        })
      );
    }

    // Paybacks → house payments. Clear ALL existing house payments inside the
    // imported date range first (covers earlier untagged imports as well as
    // tagged re-runs), then re-add the correct set. This makes re-import fully
    // self-healing. The window spans every date in the file (charges + paybacks).
    const allDates = [...chargesByDate.keys(), ...payments.map((p) => p.date)].sort();
    if (allDates.length) {
      const lo = allDates[0], hi = allDates[allDates.length - 1];
      const existing = await getHousePayments(locationId);
      for (const p of existing) {
        if (p.date >= lo && p.date <= hi) await deleteHousePayment(locationId, p.id);
      }
    }
    for (const p of payments) await addHousePayment(locationId, p.account, p.amount, p.date, HOUSE_IMPORT_TAG);
  } catch (e) {
    console.error(e);
    return { error: "Import failed while saving. Re-running is safe." };
  }

  const count = chargesByDate.size + payments.length;
  await logAudit({ userId: session.userId, action: "IMPORT", entity: "Setting", after: { kind: "house_accounts", charges: [...chargesByDate.values()].reduce((s, l) => s + l.length, 0), payments: payments.length } });
  revalidatePath("/house-accounts");
  revalidatePath("/daily");
  revalidatePath("/credit-entry");
  return { ok: true, imported: count };
}

/** Validate-then-commit CSV import for non-sales income (Money Incoming). */
export async function importMoneyIncoming(
  _prev: ImportResult | undefined,
  formData: FormData
): Promise<ImportResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission to import." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a CSV file to import." };
  const rows = parseCSV(await file.text());
  if (rows.length < 2) return { error: "The file has no data rows." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (n: string) => header.indexOf(n.toLowerCase());
  if (idx("date") === -1) return { error: "Missing required column: date." };

  const errors: { row: number; message: string }[] = [];
  const parsed: { date: Date; rent: number; gameMachine: number; stagityInvestment: number; beer: number; total: number }[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (n: string) => (idx(n) >= 0 ? (cells[idx(n)] ?? "").trim() : "");
    const lineNo = r + 1;
    const dateStr = get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { errors.push({ row: lineNo, message: `Invalid date "${dateStr}".` }); continue; }
    const n = (k: string) => { const raw = get(k); return raw === "" ? 0 : Number(raw); };
    const rent = n("rent"), gameMachine = n("gameMachine"), stagityInvestment = n("stagityInvestment"), beer = n("beer");
    if ([rent, gameMachine, stagityInvestment, beer].some((x) => isNaN(x) || x < 0)) {
      errors.push({ row: lineNo, message: `Invalid amount on row ${lineNo}.` });
      continue;
    }
    parsed.push({
      date: new Date(`${dateStr}T00:00:00.000Z`),
      rent: money(rent), gameMachine: money(gameMachine), stagityInvestment: money(stagityInvestment), beer: money(beer),
      total: money(rent + gameMachine + stagityInvestment + beer),
    });
  }
  if (errors.length) return { ok: false, errors, imported: 0 };

  try {
    const times = parsed.map((p) => p.date.getTime());
    const minDate = new Date(Math.min(...times)), maxDate = new Date(Math.max(...times) + 86400000);
    await prisma.$transaction(async (tx) => {
      await tx.moneyIncoming.deleteMany({ where: { locationId, source: "CSV_IMPORT", date: { gte: minDate, lt: maxDate } } });
      for (const p of parsed) {
        await tx.moneyIncoming.create({ data: { locationId, source: "CSV_IMPORT", ...p } });
      }
    });
  } catch (e) {
    console.error(e);
    return { error: "Import failed while saving. No rows were imported." };
  }
  await logAudit({ userId: session.userId, action: "IMPORT", entity: "MoneyIncoming", after: { count: parsed.length } });
  revalidatePath("/money-incoming");
  return { ok: true, imported: parsed.length };
}

/** Validate-then-commit CSV import for the monthly P&L summary (per year). */
export async function importMonthlySummary(
  _prev: ImportResult | undefined,
  formData: FormData
): Promise<ImportResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "viewProfit")) return { error: "You don't have permission to import." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a CSV file to import." };
  const rows = parseCSV(await file.text());
  if (rows.length < 2) return { error: "The file has no data rows." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (n: string) => header.indexOf(n.toLowerCase());
  for (const req of ["year", "category"]) if (idx(req) === -1) return { error: `Missing required column: ${req}.` };
  const monthKeys = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  const errors: { row: number; message: string }[] = [];
  const parsed: { year: number; category: string; sortOrder: number; months: number[]; annual: number }[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (n: string) => (idx(n) >= 0 ? (cells[idx(n)] ?? "").trim() : "");
    const lineNo = r + 1;
    const year = Number(get("year"));
    const category = get("category");
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { errors.push({ row: lineNo, message: `Invalid year "${get("year")}".` }); continue; }
    if (!category) { errors.push({ row: lineNo, message: `Missing category.` }); continue; }
    const months = monthKeys.map((k) => { const raw = get(k); return raw === "" ? 0 : money(Number(raw)); });
    if (months.some((m) => isNaN(m))) { errors.push({ row: lineNo, message: `Invalid number on row ${lineNo}.` }); continue; }
    const annualRaw = get("annual");
    const annual = annualRaw === "" ? money(months.reduce((s, m) => s + m, 0)) : money(Number(annualRaw));
    if (isNaN(annual)) { errors.push({ row: lineNo, message: `Invalid annual on row ${lineNo}.` }); continue; }
    parsed.push({ year, category, sortOrder: r, months, annual });
  }
  if (errors.length) return { ok: false, errors, imported: 0 };

  try {
    await prisma.$transaction(
      parsed.map((p) =>
        prisma.monthlySummary.upsert({
          where: { locationId_year_category: { locationId, year: p.year, category: p.category } },
          create: { locationId, source: "CSV_IMPORT", ...p },
          update: { sortOrder: p.sortOrder, months: p.months, annual: p.annual },
        })
      )
    );
  } catch (e) {
    console.error(e);
    return { error: "Import failed while saving. No rows were imported." };
  }
  await logAudit({ userId: session.userId, action: "IMPORT", entity: "MonthlySummary", after: { count: parsed.length } });
  revalidatePath("/summary");
  return { ok: true, imported: parsed.length };
}

/**
 * Validate-then-commit CSV import for wholesale costs. Matches products by UPC
 * and sets case cost → unit cost (+ optional pack size & vendor). Retail price is
 * left untouched (the POS owns it); cost only enables real margins. Reports the
 * unmatched count so junk-UPC items can be fixed by hand.
 */
export async function importWholesaleCosts(
  _prev: ImportResult | undefined,
  formData: FormData
): Promise<ImportResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a CSV file to import." };
  const rows = parseCSV(await file.text());
  if (rows.length < 2) return { error: "The file has no data rows." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (n: string) => header.indexOf(n.toLowerCase());
  if (idx("casecost") === -1) return { error: "Missing required column: caseCost." };
  if (idx("upc") === -1 && idx("positemid") === -1) return { error: "Need a 'upc' or 'posItemId' column to match products." };

  const errors: { row: number; message: string }[] = [];
  const parsed: { upc: string; posItemId: number | null; caseCost: number; unitsPerCase?: number; vendor?: string }[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (n: string) => (idx(n) >= 0 ? (cells[idx(n)] ?? "").trim() : "");
    const lineNo = r + 1;
    const costStr = get("caseCost");
    if (costStr === "") continue; // blank caseCost = leave this item alone
    const upc = get("upc");
    const posRaw = get("posItemId");
    const posItemId = posRaw ? Number(posRaw) : NaN;
    if (!upc && !isFinite(posItemId)) { errors.push({ row: lineNo, message: "Missing both UPC and posItemId." }); continue; }
    const caseCost = Number(costStr.replace(/[$,]/g, ""));
    if (isNaN(caseCost) || caseCost < 0) { errors.push({ row: lineNo, message: `Invalid caseCost "${costStr}".` }); continue; }
    const unitsRaw = get("unitsPerCase");
    const unitsPerCase = unitsRaw ? Math.max(1, Math.round(Number(unitsRaw))) : undefined;
    parsed.push({ upc, posItemId: isFinite(posItemId) ? posItemId : null, caseCost: money(caseCost), unitsPerCase, vendor: get("vendor") || undefined });
  }
  if (errors.length) return { ok: false, errors, imported: 0 };
  if (!parsed.length) return { ok: true, imported: 0, message: "No caseCost values filled in — nothing to update." };

  try {
    // Resolve vendors (find-or-create by name).
    const vendorNames = [...new Set(parsed.map((p) => p.vendor).filter(Boolean) as string[])];
    const vendorId = new Map<string, string>();
    for (const name of vendorNames) {
      const existing = await prisma.vendor.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
      const v = existing ?? (await prisma.vendor.create({ data: { name } }));
      vendorId.set(name.toLowerCase(), v.id);
    }

    // Load products that match any UPC or posItemId in the file.
    const upcs = [...new Set(parsed.map((p) => p.upc).filter(Boolean))];
    const posIds = [...new Set(parsed.map((p) => p.posItemId).filter((v): v is number => v != null))];
    const products = await prisma.product.findMany({
      where: { locationId, OR: [{ upc: { in: upcs } }, { posItemId: { in: posIds } }] },
      select: { id: true, upc: true, posItemId: true, unitsPerCase: true },
    });
    const byUpc = new Map(products.filter((p) => p.upc).map((p) => [p.upc!, p]));
    const byPos = new Map(products.filter((p) => p.posItemId != null).map((p) => [p.posItemId!, p]));

    let matched = 0;
    const seen = new Set<string>();
    const updates: { id: string; caseCost: number; currentCost: number; unitsPerCase?: number; vendorId?: string }[] = [];
    for (const p of parsed) {
      const prod = (p.posItemId != null && byPos.get(p.posItemId)) || (p.upc && byUpc.get(p.upc)) || null;
      if (!prod || seen.has(prod.id)) continue;
      seen.add(prod.id);
      const units = p.unitsPerCase ?? prod.unitsPerCase ?? 1;
      updates.push({
        id: prod.id,
        caseCost: p.caseCost,
        currentCost: unitCostFromCase(p.caseCost, units),
        unitsPerCase: p.unitsPerCase,
        vendorId: p.vendor ? vendorId.get(p.vendor.toLowerCase()) : undefined,
      });
      matched++;
    }

    for (let i = 0; i < updates.length; i += 50) {
      await prisma.$transaction(
        updates.slice(i, i + 50).map((u) =>
          prisma.product.update({
            where: { id: u.id },
            data: {
              caseCost: u.caseCost,
              currentCost: u.currentCost,
              ...(u.unitsPerCase ? { unitsPerCase: u.unitsPerCase } : {}),
              ...(u.vendorId ? { vendorId: u.vendorId } : {}),
            },
          })
        )
      );
    }

    await logAudit({ userId: session.userId, action: "IMPORT", entity: "Product", after: { kind: "wholesale_costs", matched, rows: parsed.length } });
    revalidatePath("/inventory");
    const unmatched = parsed.length - matched;
    return { ok: true, imported: matched, errors: unmatched > 0 ? [{ row: 0, message: `${unmatched} row(s) had no matching product UPC — those items keep their current cost.` }] : undefined };
  } catch (e) {
    console.error(e);
    return { error: "Import failed while saving." };
  }
}

/**
 * Bulk price update from a CSV (the Inventory → "Export CSV" round-trip). Matches
 * each row to a product by posItemId (preferred) or upc, then for every changed
 * price: pushes it to the POS when the item is POS-linked (price mirrors locally
 * only on a successful push), or updates the local price directly otherwise.
 * Validation is all-or-nothing; POS push failures are reported in the summary.
 */
export async function importInventoryPrices(
  _prev: ImportResult | undefined,
  formData: FormData
): Promise<ImportResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission to update prices." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a CSV file to import." };

  const rows = parseCSV(await file.text());
  if (rows.length < 2) return { error: "The file has no data rows." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  const newRetailIdx = idx("newretail");
  const posIdx = idx("positemid");
  const upcIdx = idx("upc");
  if (newRetailIdx === -1) return { error: "Missing the 'newRetail' column. Download the template or use Inventory → Export CSV." };
  if (posIdx === -1 && upcIdx === -1) return { error: "Need a 'posItemId' or 'upc' column to match products." };

  const products = await prisma.product.findMany({
    where: { locationId },
    select: { id: true, posItemId: true, posDeptId: true, upc: true, sellingPrice: true, name: true },
  });
  const byPos = new Map(products.filter((p) => p.posItemId != null).map((p) => [p.posItemId!, p]));
  const byUpc = new Map(products.filter((p) => p.upc).map((p) => [p.upc!.trim(), p]));

  const errors: { row: number; message: string }[] = [];
  const matched: { p: (typeof products)[number]; price: number }[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const priceStr = (r[newRetailIdx] ?? "").trim();
    if (priceStr === "") continue; // blank newRetail = leave this item alone
    const price = Number(priceStr.replace(/[$,]/g, ""));
    const posId = posIdx >= 0 ? Number((r[posIdx] ?? "").trim()) : NaN;
    const upc = upcIdx >= 0 ? (r[upcIdx] ?? "").trim() : "";
    if (!isFinite(price) || price < 0) { errors.push({ row: i + 1, message: `Invalid newRetail "${priceStr}".` }); continue; }
    const p = (isFinite(posId) && byPos.get(posId)) || (upc && byUpc.get(upc)) || null;
    if (!p) { errors.push({ row: i + 1, message: `No product matched (posItemId=${isFinite(posId) ? posId : "—"}, upc=${upc || "—"}).` }); continue; }
    if (seen.has(p.id)) continue; // first row for a product wins
    seen.add(p.id);
    matched.push({ p, price: money(price) });
  }
  if (errors.length) return { errors }; // validation failed — nothing committed

  const changed = matched.filter((m) => m.price !== m.p.sellingPrice);
  if (!changed.length) return { ok: true, imported: 0, message: "No price changes found — every row already matches the catalog." };

  try {
    // POS-linked items: push (the helper mirrors the price locally on success).
    const pushable = changed.filter((m) => m.p.posItemId && m.p.posDeptId);
    let pushed = 0, pushSkipped = 0, pushFailed = 0;
    if (pushable.length) {
      const { results } = await pushPrices(
        locationId,
        pushable.map((m) => ({ productId: m.p.id, posItemId: m.p.posItemId!, posDeptId: m.p.posDeptId, newRetail: m.price }))
      );
      pushed = results.filter((r) => r.ok && !r.skipped).length;
      pushSkipped = results.filter((r) => r.skipped).length;
      pushFailed = results.filter((r) => !r.ok).length;
    }

    // Non-POS items: just update the local price.
    const localOnly = changed.filter((m) => !(m.p.posItemId && m.p.posDeptId));
    for (let i = 0; i < localOnly.length; i += 50) {
      await prisma.$transaction(
        localOnly.slice(i, i + 50).map((m) =>
          prisma.product.update({ where: { id: m.p.id }, data: { sellingPrice: m.price } })
        )
      );
    }

    await logAudit({ userId: session.userId, action: "IMPORT", entity: "Product", after: { priceImport: { changed: changed.length, pushed, pushSkipped, pushFailed, localOnly: localOnly.length } } });
    revalidatePath("/inventory");
    const parts = [`${changed.length} price${changed.length === 1 ? "" : "s"} updated`];
    if (pushable.length) parts.push(`${pushed} pushed to POS`, `${pushSkipped} already current`, `${pushFailed} failed`);
    if (localOnly.length) parts.push(`${localOnly.length} app-only (not POS-linked)`);
    return { ok: true, imported: pushed || changed.length, message: parts.join(" · ") + "." };
  } catch (e) {
    console.error(e);
    return { error: e instanceof Error ? e.message : "Price import failed while saving." };
  }
}
