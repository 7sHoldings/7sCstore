import "server-only";
import { prisma } from "./db";
import { money } from "./calc";

/**
 * Computed Monthly Summary (P&L) — built from the app's own data instead of an
 * imported Excel sheet. For each month of a year it aggregates:
 *   Income  = Inside (merch) + Fuel + Net Lottery + Other Income
 *   Costs   = Inventory Purchases + Gas Invoices + Operating Expenses
 *   Profit  = Income − Costs
 * Per day it prefers the imported daily-sheet summary when present (so historical
 * months match what you keyed in), otherwise it computes from the live POS rows.
 * Sales tax and cash/card are shown for reference — tax is a pass-through and is
 * NOT part of profit.
 */

const MERCH_CATS = new Set(["STORE", "FOOD_DRINK", "TOBACCO", "OTHER"]);

export type RowKind = "line" | "neg" | "subtotal" | "total" | "profit" | "info";
export interface SummaryRow {
  label: string;
  section?: string; // section header shown before this row
  kind: RowKind;
  months: number[]; // length 12
  annual: number;
}

export interface YearSummary {
  year: number;
  rows: SummaryRow[];
  kpis: { income: number; expenses: number; profit: number };
}

const zeros = () => Array.from({ length: 12 }, () => 0);

/** Distinct years that have any data, oldest → newest (falls back to current). */
export async function availableSummaryYears(loc: string): Promise<number[]> {
  const [firstSale, firstSummary, firstExpense] = await Promise.all([
    prisma.sale.findFirst({ where: { locationId: loc }, orderBy: { date: "asc" }, select: { date: true } }),
    prisma.dailySalesSummary.findFirst({ where: { locationId: loc }, orderBy: { date: "asc" }, select: { date: true } }),
    prisma.expense.findFirst({ where: { locationId: loc }, orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  const yearsWithData = [firstSale, firstSummary, firstExpense]
    .filter(Boolean)
    .map((r) => r!.date.getUTCFullYear());
  const now = new Date().getUTCFullYear();
  const start = yearsWithData.length ? Math.min(...yearsWithData) : now;
  const out: number[] = [];
  for (let y = start; y <= Math.max(now, start); y++) out.push(y);
  return out;
}

export async function buildYearSummary(loc: string, year: number): Promise<YearSummary> {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const dateWhere = { locationId: loc, date: { gte: from, lt: to } };

  const [summaries, sales, fuelSales, settings, expenses, incoming, deliveries] = await Promise.all([
    prisma.dailySalesSummary.findMany({ where: dateWhere }),
    prisma.sale.findMany({ where: dateWhere, select: { category: true, amount: true, refund: true, date: true } }),
    prisma.fuelSale.findMany({ where: dateWhere, select: { total: true, date: true } }),
    prisma.setting.findMany({
      where: { OR: ["tax", "cashdrop", "cashmanual", "ccjobber"].map((p) => ({ key: { startsWith: `${p}:${loc}:${year}` } })) },
    }),
    prisma.expense.findMany({ where: dateWhere, select: { category: true, amount: true, date: true } }),
    prisma.moneyIncoming.findMany({ where: dateWhere, select: { total: true, date: true } }),
    prisma.fuelDelivery.findMany({ where: dateWhere, select: { total: true, date: true } }),
  ]);

  // ---- per-day computed income (used when a day has no imported summary) ----
  const dayISO = (d: Date) => d.toISOString().slice(0, 10);
  const merchByDay = new Map<string, number>();
  const fuelByDay = new Map<string, number>();
  const lSalesByDay = new Map<string, number>();
  const lPayByDay = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const s of sales) {
    const k = dayISO(s.date);
    if (s.category === "LOTTERY") {
      if (s.amount >= 0) add(lSalesByDay, k, s.amount);
      else add(lPayByDay, k, -s.amount);
    } else if (MERCH_CATS.has(s.category)) {
      add(merchByDay, k, s.amount - (s.refund || 0));
    }
  }
  for (const f of fuelSales) add(fuelByDay, dayISO(f.date), f.total);

  // ---- per-day tender from settings ----
  const cashPos = new Map<string, number>(), cashMan = new Map<string, number>(), cardByDay = new Map<string, number>();
  const taxMonth = zeros();
  for (const r of settings) {
    const parts = r.key.split(":");
    const kind = parts[0];
    const date = parts[parts.length - 1];
    const v = Number(r.value) || 0;
    if (kind === "tax") { taxMonth[Number(date.slice(5, 7)) - 1] += v; continue; }
    if (kind === "cashmanual") cashMan.set(date, v);
    else if (kind === "cashdrop") cashPos.set(date, v);
    else if (kind === "ccjobber") cardByDay.set(date, v);
  }
  const cashForDay = (d: string) => (cashMan.has(d) ? cashMan.get(d)! : cashPos.get(d) ?? 0);

  // ---- merge per day (imported summary wins), aggregate to months ----
  const inside = zeros(), fuel = zeros(), lSales = zeros(), lPay = zeros(), cash = zeros(), card = zeros();
  const summaryByDay = new Map(summaries.map((s) => [dayISO(s.date), s]));
  const allDays = new Set<string>([
    ...summaryByDay.keys(), ...merchByDay.keys(), ...fuelByDay.keys(),
    ...lSalesByDay.keys(), ...lPayByDay.keys(), ...cashPos.keys(), ...cashMan.keys(), ...cardByDay.keys(),
  ]);
  for (const d of allDays) {
    const m = Number(d.slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    const s = summaryByDay.get(d);
    if (s) {
      inside[m] += s.dailySales; fuel[m] += s.fuel;
      lSales[m] += s.lotto + s.lottery; lPay[m] += s.lotteryPayout;
      cash[m] += s.cash; card[m] += s.credit;
    } else {
      inside[m] += merchByDay.get(d) ?? 0; fuel[m] += fuelByDay.get(d) ?? 0;
      lSales[m] += lSalesByDay.get(d) ?? 0; lPay[m] += lPayByDay.get(d) ?? 0;
      cash[m] += cashForDay(d); card[m] += cardByDay.get(d) ?? 0;
    }
  }

  // ---- expenses / other income / fuel invoices by month ----
  const inventory = zeros(), gasInvoices = zeros(), operating = zeros(), otherIncome = zeros();
  for (const e of expenses) {
    const m = e.date.getUTCMonth();
    if (e.category === "INVENTORY_PURCHASE") inventory[m] += e.amount;
    else if (e.category === "FUEL_PURCHASE") gasInvoices[m] += e.amount;
    else operating[m] += e.amount;
  }
  for (const d of deliveries) gasInvoices[d.date.getUTCMonth()] += d.total;
  for (const i of incoming) otherIncome[i.date.getUTCMonth()] += i.total;

  // ---- derived series ----
  const map = (fn: (m: number) => number) => Array.from({ length: 12 }, (_, m) => money(fn(m)));
  const netLottery = map((m) => lSales[m] - lPay[m]);
  const totalIncome = map((m) => inside[m] + fuel[m] + netLottery[m] + otherIncome[m]);
  const totalExpenses = map((m) => inventory[m] + gasInvoices[m] + operating[m]);
  const netProfit = map((m) => totalIncome[m] - totalExpenses[m]);

  const annual = (arr: number[]) => money(arr.reduce((a, b) => a + b, 0));
  const row = (label: string, arr: number[], kind: RowKind, section?: string): SummaryRow =>
    ({ label, kind, section, months: arr.map((v) => money(v)), annual: annual(arr) });

  const rows: SummaryRow[] = [
    row("Inside Sales", inside, "line", "Income & Sales"),
    row("Fuel Sales", fuel, "line"),
    row("Lottery Sales", lSales, "line"),
    row("Lottery Payout", lPay.map((v) => -v), "neg"),
    row("Net Lottery", netLottery, "subtotal"),
    row("Other Income", otherIncome, "line"),
    row("Total Income", totalIncome, "total"),

    row("Inventory Purchases", inventory, "line", "Costs & Expenses"),
    row("Gas Invoices (fuel cost)", gasInvoices, "line"),
    row("Operating Expenses", operating, "line"),
    row("Total Expenses", totalExpenses, "total"),

    row("Net Profit", netProfit, "profit", "Profit"),

    row("Cash (Safe Drop)", cash, "info", "Collected — for reference"),
    row("Credit / Debit", card, "info"),
    row("Sales Tax Collected", taxMonth, "info"),
  ];

  return {
    year,
    rows,
    kpis: { income: annual(totalIncome), expenses: annual(totalExpenses), profit: annual(netProfit) },
  };
}
