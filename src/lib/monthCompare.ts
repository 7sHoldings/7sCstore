import "server-only";
import { prisma } from "./db";
import { money } from "./calc";
import { buildSalesView, deptName } from "./salesView";
import { getTaxRange, getTenderRange } from "./integrations/sync";
import { getLotteryManualRange } from "./lottery";
import { getCreditManualRange } from "./credit";

/**
 * Every figure the Monthly Summary shows for one window, computed exactly the
 * way the Dashboard computes it for the same dates — so a month here matches
 * the Dashboard with that month selected.
 */
export interface WindowFigures {
  hasSales: boolean;
  posSales: number; // Daily + Fuel + Lottery + Sales Tax
  merch: number;
  fuel: number;
  gallons: number;
  lottoNet: number;
  salesTax: number;
  refunds: number;
  depts: { name: string; sales: number }[]; // merchandise departments
  fuelGrades: { grade: string; gallons: number; total: number; price: number }[];
  lotto: {
    sales: number;
    payout: number;
    net: number;
    manual: { sales: number; payout: number; credit: number; net: number } | null;
    over: number; // system − manual (0 with no manual entry)
  };
  tender: { cash: number; card: number } | null;
  recon: { label: string; value: number }[]; // signed parts of the short/over
  shortOver: number | null; // null until tender is synced
  expenses: {
    total: number;
    inventory: number;
    operating: number;
    fuel: number;
    byPayee: { key: string; group: "Inventory" | "Operating" | "Fuel"; value: number }[];
  };
  incoming: number;
  profit: number; // owner's Profit / Loss (same formula as the Dashboard)
  profitParts: { label: string; op: "+" | "−"; raw: number }[];
}

const GROUP: Record<string, "Inventory" | "Operating" | "Fuel"> = {
  INVENTORY_PURCHASE: "Inventory",
  FUEL_PURCHASE: "Fuel",
};

export async function getWindowFigures(loc: string, start: Date, end: Date): Promise<WindowFigures> {
  const where = { locationId: loc, date: { gte: start, lt: end } };
  const [sales, fuelSales, expenseRows, incomingAgg, realTax, tender, manualRaw, creditManual] = await Promise.all([
    prisma.sale.findMany({ where, select: { paymentType: true, amount: true, refund: true, category: true, note: true } }),
    prisma.fuelSale.findMany({ where, select: { grade: true, gallons: true, total: true, pricePerGallon: true } }),
    prisma.expense.findMany({ where, select: { category: true, amount: true, payee: true } }),
    prisma.moneyIncoming.aggregate({ _sum: { total: true }, where }),
    getTaxRange(loc, start, end),
    getTenderRange(loc, start, end),
    getLotteryManualRange(loc, start, end),
    getCreditManualRange(loc, start, end),
  ]);

  const view = buildSalesView(sales, fuelSales);
  const salesTax = money(realTax);
  const posSales = money(view.total.total + salesTax);

  let lSales = 0, lPay = 0;
  for (const d of view.lotto.depts) {
    if (d.sales >= 0) lSales += d.sales;
    else lPay += -d.sales;
  }
  const lottoNet = view.lotto.split.total;
  const manual = manualRaw
    ? { ...manualRaw, net: money(manualRaw.sales - manualRaw.payout - manualRaw.credit) }
    : null;
  const lottoOver = manual ? money(lottoNet - manual.net) : 0;

  const houseTotal = creditManual ? creditManual.house.reduce((s, h) => s + h.amount, 0) : 0;
  const payoutTotal = creditManual ? creditManual.payouts.reduce((s, h) => s + h.amount, 0) : 0;
  const recon = tender
    ? [
        { label: "Credit card", value: money(tender.card) },
        { label: "Safe drop (cash)", value: money(tender.cash) },
        { label: "EBT", value: creditManual?.ebt ?? 0 },
        { label: "Other credit", value: creditManual?.otherCredit ?? 0 },
        { label: "Payout in cash", value: money(payoutTotal) },
        { label: "House account", value: money(houseTotal) },
        { label: "Lottery short/over", value: lottoOver },
        { label: "POS sales", value: -posSales },
      ]
    : [];
  const shortOver = tender ? money(recon.reduce((s, p) => s + p.value, 0)) : null;

  // Expenses, by payee (falls back to the category when no payee was typed).
  const payee = new Map<string, { group: "Inventory" | "Operating" | "Fuel"; value: number }>();
  let inventory = 0, operating = 0, fuelCost = 0;
  for (const e of expenseRows) {
    const group = GROUP[e.category] ?? "Operating";
    if (group === "Inventory") inventory += e.amount;
    else if (group === "Fuel") fuelCost += e.amount;
    else operating += e.amount;
    const name = (e.payee || "").trim() || e.category.replace(/_/g, " ").toLowerCase();
    const k = `${group}|${name}`;
    const cur = payee.get(k) ?? { group, value: 0 };
    cur.value += e.amount;
    payee.set(k, cur);
  }
  const totalExpenses = money(inventory + operating + fuelCost);
  const incoming = money(incomingAgg._sum.total ?? 0);

  // Owner's Profit / Loss — identical to the Dashboard card.
  const profitParts: WindowFigures["profitParts"] = [
    { label: "Total Sales", op: "+", raw: posSales },
    { label: "Total Expenses", op: "−", raw: totalExpenses },
    { label: "Fuel", op: "−", raw: view.fuel.split.total },
    { label: "Lottery net (manual)", op: "−", raw: manual ? manual.net : lottoNet },
    { label: "Lottery short/over", op: "+", raw: lottoOver },
    { label: "Money Incoming", op: "+", raw: incoming },
    { label: "Sales short/over", op: "+", raw: shortOver ?? 0 },
  ];
  const profit = money(profitParts.reduce((s, p) => s + (p.op === "−" ? -p.raw : p.raw), 0));

  return {
    hasSales: sales.length > 0 || fuelSales.length > 0,
    posSales,
    merch: view.merch.split.total,
    fuel: view.fuel.split.total,
    gallons: money(view.fuel.gallons),
    lottoNet,
    salesTax,
    refunds: view.merch.refund,
    depts: view.merch.depts.map((d) => ({ name: d.name, sales: d.sales })),
    fuelGrades: view.fuel.byGrade,
    lotto: { sales: money(lSales), payout: money(lPay), net: lottoNet, manual, over: lottoOver },
    tender,
    recon,
    shortOver,
    expenses: {
      total: totalExpenses,
      inventory: money(inventory),
      operating: money(operating),
      fuel: money(fuelCost),
      byPayee: [...payee.entries()].map(([k, v]) => ({ key: k.split("|")[1], group: v.group, value: money(v.value) })),
    },
    incoming,
    profit,
    profitParts,
  };
}

/** Lighter per-month figures for the 12-month trend (sales side + expenses). */
export interface TrendMonth {
  ym: string;
  posSales: number;
  merch: number;
  fuel: number;
  gallons: number;
  lottoNet: number;
  expenses: number;
  depts: Map<string, number>;
}

export async function getTrend(loc: string, months: string[]): Promise<TrendMonth[]> {
  if (!months.length) return [];
  const [y0, m0] = months[0].split("-").map(Number);
  const [y1, m1] = months[months.length - 1].split("-").map(Number);
  const start = new Date(Date.UTC(y0, m0 - 1, 1));
  const end = new Date(Date.UTC(y1, m1, 1));
  const where = { locationId: loc, date: { gte: start, lt: end } };
  const [sales, fuelSales, expenses, taxRows] = await Promise.all([
    prisma.sale.findMany({ where, select: { amount: true, category: true, note: true, date: true } }),
    prisma.fuelSale.findMany({ where, select: { gallons: true, date: true } }),
    prisma.expense.findMany({ where, select: { amount: true, date: true } }),
    prisma.setting.findMany({ where: { key: { startsWith: `tax:${loc}:` } }, select: { key: true, value: true } }),
  ]);
  const byYm = new Map<string, TrendMonth>(
    months.map((ym) => [ym, { ym, posSales: 0, merch: 0, fuel: 0, gallons: 0, lottoNet: 0, expenses: 0, depts: new Map() }])
  );
  const ymOf = (d: Date) => d.toISOString().slice(0, 7);
  for (const s of sales) {
    const t = byYm.get(ymOf(s.date));
    if (!t) continue;
    t.posSales += s.amount;
    if (s.category === "FUEL") t.fuel += s.amount;
    else if (s.category === "LOTTERY") t.lottoNet += s.amount;
    else {
      t.merch += s.amount;
      const n = deptName(s.note, s.category);
      t.depts.set(n, (t.depts.get(n) ?? 0) + s.amount);
    }
  }
  for (const f of fuelSales) {
    const t = byYm.get(ymOf(f.date));
    if (t) t.gallons += f.gallons;
  }
  for (const e of expenses) {
    const t = byYm.get(ymOf(e.date));
    if (t) t.expenses += e.amount;
  }
  for (const r of taxRows) {
    const t = byYm.get(r.key.split(":").pop()!.slice(0, 7));
    if (t) t.posSales += Number(r.value) || 0;
  }
  return [...byYm.values()].map((t) => ({
    ...t,
    posSales: money(t.posSales),
    merch: money(t.merch),
    fuel: money(t.fuel),
    gallons: money(t.gallons),
    lottoNet: money(t.lottoNet),
    expenses: money(t.expenses),
    depts: new Map([...t.depts.entries()].map(([k, v]) => [k, money(v)])),
  }));
}

// ---------------------------------------------------------------------------
// Products inside a department
// ---------------------------------------------------------------------------

/**
 * The POS keeps a running "units sold" counter per item, and the daily sync
 * stores one reading of it per day (ProductMovement). Units sold in a window
 * are the counter at the end of the window minus the counter at its start.
 * Readings only exist from the day this started, so `trackedFrom` says where
 * the history begins — a window before it has no product numbers.
 */
export interface ProductWindow {
  upc: string;
  units: number;
}

export async function productTrackingStart(loc: string): Promise<Date | null> {
  const first = await prisma.productMovement.findFirst({
    where: { locationId: loc },
    orderBy: { takenAt: "asc" },
    select: { takenAt: true },
  });
  return first?.takenAt ?? null;
}

/** Counter value per UPC at instant `at` (latest reading on or before it). */
async function counterAt(loc: string, upcs: string[], at: Date): Promise<Map<string, number>> {
  if (!upcs.length) return new Map();
  const rows = await prisma.$queryRaw<{ upcNorm: string; soldUnits: number }[]>`
    SELECT DISTINCT ON ("upcNorm") "upcNorm", "soldUnits"
    FROM "ProductMovement"
    WHERE "locationId" = ${loc} AND "takenAt" <= ${at} AND "upcNorm" = ANY(${upcs})
    ORDER BY "upcNorm", "takenAt" DESC`;
  return new Map(rows.map((r) => [r.upcNorm, Number(r.soldUnits) || 0]));
}

/**
 * Units sold per UPC in [start, end), or null when the window ends before
 * tracking began. `partial` is true when tracking began inside the window.
 */
export async function productUnits(
  loc: string,
  upcs: string[],
  start: Date,
  end: Date,
  trackedFrom: Date | null
): Promise<{ units: Map<string, number>; partial: boolean } | null> {
  if (!trackedFrom || end <= trackedFrom) return null;
  const from = start < trackedFrom ? trackedFrom : start;
  // The latest reading inside the window stands in for its end (today's sync may not have run).
  const [a, b] = await Promise.all([counterAt(loc, upcs, from), counterAt(loc, upcs, end)]);
  const units = new Map<string, number>();
  for (const [upc, endVal] of b) {
    const v = endVal - (a.get(upc) ?? endVal);
    if (v > 0) units.set(upc, v);
  }
  return { units, partial: start < trackedFrom };
}

export const normUpc = (u: string | null | undefined) => String(u ?? "").replace(/\D/g, "").replace(/^0+/, "");
