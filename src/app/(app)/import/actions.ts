"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { parseCSV, SALES_TEMPLATE_HEADERS, EXPENSE_TEMPLATE_HEADERS, DAILY_SALES_TEMPLATE_HEADERS } from "@/lib/csv";
import { money, perGallon } from "@/lib/calc";
import { setLotteryManual } from "@/lib/lottery";
import { setCreditManual } from "@/lib/credit";

const CATEGORIES = ["FUEL", "STORE", "LOTTERY", "TOBACCO", "FOOD_DRINK", "OTHER"];
const PAYMENTS = ["CASH", "CARD", "OTHER"];
const GRADES = ["REGULAR", "MID", "PREMIUM", "DIESEL"];

const EXPENSE_CATEGORIES = ["STORE_OPERATING_EXPENSES", "INVENTORY_PURCHASE"];
const EXPENSE_PAYMENTS = ["CASH", "CARD", "CHECK", "OTHER"];

export interface ImportResult {
  ok?: boolean;
  imported?: number;
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
    await prisma.$transaction(async (tx) => {
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
