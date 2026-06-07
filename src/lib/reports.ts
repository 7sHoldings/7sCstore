/**
 * Reporting service — the bridge between stored data and the calculation engine.
 *
 * Every dashboard widget and report pulls from here, so they all agree on the
 * numbers (FR-29, FR-33, FR-34). Functions accept a Range and an optional
 * locationId (multi-location ready, A2) and return plain serialisable objects.
 */
import { prisma } from "./db";
import {
  buildPnL,
  paymentSplit,
  salesByCategory,
  fuelMarginPerGallon,
  purchaseMargin,
  pctChange,
  money,
  type PnL,
  type SaleLike,
  type FuelSaleLike,
} from "./calc";
import { type Range, dayBuckets, rangeFor, previousRange, type PeriodKey } from "./period";

type Where = { date: { gte: Date; lt: Date }; locationId?: string };

function where(r: Range, locationId?: string): Where {
  const w: Where = { date: { gte: r.start, lt: r.end } };
  if (locationId) w.locationId = locationId;
  return w;
}

async function load(r: Range, locationId?: string) {
  const [sales, fuelSales, expenses, purchases] = await Promise.all([
    prisma.sale.findMany({ where: where(r, locationId) }),
    prisma.fuelSale.findMany({ where: where(r, locationId) }),
    prisma.expense.findMany({ where: where(r, locationId) }),
    prisma.purchase.findMany({ where: where(r, locationId) }),
  ]);
  return { sales, fuelSales, expenses, purchases };
}

/**
 * Estimate store COGS for the period. Phase 1 has no item-level sales, so we
 * apply each non-fuel sale's cost using the average product margin implied by
 * purchases. If no purchase data exists we fall back to 0 (revenue-only view).
 */
function estimateStoreCOGS(
  sales: SaleLike[],
  purchases: { qty: number; costEach: number; total: number; sellPrice: number }[]
): number {
  const nonFuelNet = sales
    .filter((s) => s.category !== "FUEL")
    .reduce((sum, s) => sum + s.amount - s.refund, 0);
  if (nonFuelNet <= 0 || purchases.length === 0) return 0;

  // Average cost ratio = total cost / total potential retail across purchases.
  let cost = 0;
  let retail = 0;
  for (const p of purchases) {
    cost += p.total;
    retail += p.sellPrice > 0 ? p.sellPrice * p.qty : p.total;
  }
  const ratio = retail > 0 ? cost / retail : 0;
  return money(nonFuelNet * ratio);
}

export interface DashboardData {
  range: Range;
  pnl: PnL;
  payment: ReturnType<typeof paymentSplit>;
  byCategory: ReturnType<typeof salesByCategory>;
  fuel: {
    gallons: number;
    total: number;
    byGrade: { grade: string; gallons: number; total: number; margin: number; profit: number }[];
  };
  store: { total: number };
  trend: { date: string; fuel: number; store: number }[];
  comparison: {
    netSales: number | null;
    netProfit: number | null;
    grossSales: number | null;
  };
}

export async function getDashboard(
  r: Range,
  locationId?: string
): Promise<DashboardData> {
  const { sales, fuelSales, expenses, purchases } = await load(r, locationId);
  const storeCOGS = estimateStoreCOGS(sales, purchases);

  const pnl = buildPnL({
    sales: sales as SaleLike[],
    fuelSales: fuelSales as FuelSaleLike[],
    expenses,
    storeCOGS,
  });

  // Fuel summary by grade (FR-3, FR-31).
  const gradeMap = new Map<
    string,
    { gallons: number; total: number; profit: number; cost: number; tax: number; price: number; n: number }
  >();
  for (const f of fuelSales as FuelSaleLike[]) {
    const g = gradeMap.get(f.grade) ?? {
      gallons: 0,
      total: 0,
      profit: 0,
      cost: 0,
      tax: 0,
      price: 0,
      n: 0,
    };
    g.gallons += f.gallons;
    g.total += f.total;
    g.profit += fuelMarginPerGallon(f) * f.gallons;
    g.cost += f.costPerGallon;
    g.tax += f.taxPerGallon;
    g.price += f.pricePerGallon;
    g.n += 1;
    gradeMap.set(f.grade, g);
  }
  const byGrade = [...gradeMap.entries()].map(([grade, v]) => ({
    grade,
    gallons: money(v.gallons),
    total: money(v.total),
    margin: v.n
      ? fuelMarginPerGallon({
          pricePerGallon: v.price / v.n,
          costPerGallon: v.cost / v.n,
          taxPerGallon: v.tax / v.n,
        })
      : 0,
    profit: money(v.profit),
  }));

  const fuelGallons = byGrade.reduce((s, g) => s + g.gallons, 0);
  const fuelTotal = byGrade.reduce((s, g) => s + g.total, 0);
  const byCategory = salesByCategory(sales as SaleLike[]);

  // Daily trend split fuel vs store (FR-7).
  const buckets = dayBuckets(r);
  const trend = buckets.map((day) => {
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const inDay = (d: Date) => d >= day && d < next;
    let fuel = 0;
    let store = 0;
    for (const s of sales) {
      if (!inDay(s.date)) continue;
      if (s.category === "FUEL") fuel += s.amount;
      else store += s.amount;
    }
    return { date: day.toISOString().slice(0, 10), fuel: money(fuel), store: money(store) };
  });

  // Comparison vs previous equivalent period (FR-6).
  const prev = previousRange(r);
  const prevData = await load(prev, locationId);
  const prevStoreCOGS = estimateStoreCOGS(prevData.sales, prevData.purchases);
  const prevPnl = buildPnL({
    sales: prevData.sales as SaleLike[],
    fuelSales: prevData.fuelSales as FuelSaleLike[],
    expenses: prevData.expenses,
    storeCOGS: prevStoreCOGS,
  });

  return {
    range: r,
    pnl,
    payment: paymentSplit(sales as SaleLike[]),
    byCategory,
    fuel: { gallons: money(fuelGallons), total: money(fuelTotal), byGrade },
    store: { total: byCategory.STORE + byCategory.LOTTERY + byCategory.TOBACCO + byCategory.FOOD_DRINK + byCategory.OTHER },
    trend,
    comparison: {
      netSales: pctChange(pnl.netSales, prevPnl.netSales),
      netProfit: pctChange(pnl.netProfit, prevPnl.netProfit),
      grossSales: pctChange(pnl.grossSales, prevPnl.grossSales),
    },
  };
}

/** Multi-period headline totals for the dashboard top strip (FR-1). */
export async function getPeriodTotals(locationId?: string) {
  const keys: PeriodKey[] = ["today", "wtd", "mtd", "ytd"];
  const out: Record<string, { netSales: number; netProfit: number }> = {};
  for (const k of keys) {
    const r = rangeFor(k);
    const { sales, fuelSales, expenses, purchases } = await load(r, locationId);
    const pnl = buildPnL({
      sales: sales as SaleLike[],
      fuelSales: fuelSales as FuelSaleLike[],
      expenses,
      storeCOGS: estimateStoreCOGS(sales as SaleLike[], purchases),
    });
    out[k] = { netSales: pnl.netSales, netProfit: pnl.netProfit };
  }
  return out;
}

/** Full P&L plus supporting breakdowns for the report exports (FR-33). */
export async function getReportData(r: Range, locationId?: string) {
  const { sales, fuelSales, expenses, purchases } = await load(r, locationId);
  const storeCOGS = estimateStoreCOGS(sales as SaleLike[], purchases);
  const pnl = buildPnL({
    sales: sales as SaleLike[],
    fuelSales: fuelSales as FuelSaleLike[],
    expenses,
    storeCOGS,
  });

  // Expenses grouped by category.
  const expenseByCat = new Map<string, number>();
  for (const e of expenses) {
    expenseByCat.set(e.category, (expenseByCat.get(e.category) ?? 0) + e.amount);
  }

  return {
    range: r,
    pnl,
    byCategory: salesByCategory(sales as SaleLike[]),
    payment: paymentSplit(sales as SaleLike[]),
    expensesByCategory: [...expenseByCat.entries()]
      .map(([category, amount]) => ({ category, amount: money(amount) }))
      .sort((a, b) => b.amount - a.amount),
    purchaseLines: purchases.map((p) => ({
      ...p,
      margin: purchaseMargin(p),
    })),
    counts: {
      sales: sales.length,
      expenses: expenses.length,
      purchases: purchases.length,
    },
  };
}
