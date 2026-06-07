/**
 * FuelTrack calculation engine.
 *
 * Implements the financial definitions in SRS Section 3 *exactly as written*.
 * All money is rounded to 2 decimals; $/gallon figures keep 4 decimals (NFR-2).
 *
 * Keeping every formula in one place means reports, the dashboard, and any
 * future POS-fed data all compute profit the same way (FR-29).
 */

export type PaymentTypeStr = "CASH" | "CARD" | "OTHER";
export type SaleCategoryStr =
  | "FUEL"
  | "STORE"
  | "LOTTERY"
  | "TOBACCO"
  | "FOOD_DRINK"
  | "OTHER";

export interface SaleLike {
  category: SaleCategoryStr;
  paymentType: PaymentTypeStr;
  amount: number; // gross sale value excluding sales tax
  taxCollected: number;
  refund: number;
}

export interface FuelSaleLike {
  grade: string;
  gallons: number;
  pricePerGallon: number;
  total: number;
  taxPerGallon: number;
  costPerGallon: number;
}

export interface ExpenseLike {
  amount: number;
}

export interface PurchaseLike {
  qty: number;
  costEach: number;
  total: number;
  sellPrice: number;
}

/** Round to `dp` decimal places using half-up rounding, avoiding FP drift. */
export function round(value: number, dp = 2): number {
  if (!isFinite(value)) return 0;
  const f = Math.pow(10, dp);
  return Math.round((value + Number.EPSILON) * f) / f;
}

export const money = (v: number) => round(v, 2);
export const perGallon = (v: number) => round(v, 4);

/** Gross Sales — total value of all sales, excluding sales tax collected. */
export function grossSales(sales: SaleLike[]): number {
  return money(sales.reduce((sum, s) => sum + s.amount, 0));
}

/** Sales Tax Collected — tracked separately as a liability, not revenue. */
export function salesTaxCollected(sales: SaleLike[]): number {
  return money(sales.reduce((sum, s) => sum + s.taxCollected, 0));
}

/** Total refunds / voids. */
export function totalRefunds(sales: SaleLike[]): number {
  return money(sales.reduce((sum, s) => sum + s.refund, 0));
}

/** Net Sales = Gross Sales − refunds/voids. */
export function netSales(sales: SaleLike[]): number {
  return money(grossSales(sales) - totalRefunds(sales));
}

/**
 * Cost of Goods Sold (COGS) — cost of the items actually sold.
 *
 * Phase 1 records sales as category totals rather than line items, so store
 * COGS is approximated from purchases (Average Cost basis). Fuel COGS is exact:
 * gallons sold × cost per gallon. As item-level POS data arrives in Phase 2 the
 * store figure becomes exact without changing any caller.
 */
export function fuelCOGS(fuelSales: FuelSaleLike[]): number {
  return money(
    fuelSales.reduce((sum, f) => sum + f.gallons * f.costPerGallon, 0)
  );
}

/** Gross Profit = Net Sales − COGS. */
export function grossProfit(netSalesValue: number, cogs: number): number {
  return money(netSalesValue - cogs);
}

/** Operating Expenses — all expenses that are NOT COGS. */
export function operatingExpenses(expenses: ExpenseLike[]): number {
  return money(expenses.reduce((sum, e) => sum + e.amount, 0));
}

/** Net Profit = Gross Profit − Operating Expenses. */
export function netProfit(grossProfitValue: number, opex: number): number {
  return money(grossProfitValue - opex);
}

/** Profit Margin (%) = (Gross Profit ÷ Net Sales) × 100. */
export function profitMargin(grossProfitValue: number, netSalesValue: number): number {
  if (netSalesValue === 0) return 0;
  return round((grossProfitValue / netSalesValue) * 100, 2);
}

/**
 * Fuel margin per gallon = pump price − (cost per gallon + fuel taxes per gallon).
 */
export function fuelMarginPerGallon(f: {
  pricePerGallon: number;
  costPerGallon: number;
  taxPerGallon: number;
}): number {
  return perGallon(f.pricePerGallon - (f.costPerGallon + f.taxPerGallon));
}

/** Total fuel profit across sales, using per-gallon margin × gallons (FR-31). */
export function fuelProfit(fuelSales: FuelSaleLike[]): number {
  return money(
    fuelSales.reduce(
      (sum, f) => sum + fuelMarginPerGallon(f) * f.gallons,
      0
    )
  );
}

/** Cash vs card split of gross sales (FR-4). */
export function paymentSplit(sales: SaleLike[]) {
  const split = { cash: 0, card: 0, other: 0 };
  for (const s of sales) {
    if (s.paymentType === "CASH") split.cash += s.amount;
    else if (s.paymentType === "CARD") split.card += s.amount;
    else split.other += s.amount;
  }
  return {
    cash: money(split.cash),
    card: money(split.card),
    other: money(split.other),
  };
}

/** Totals grouped by sale category (FR-30, sales-by-category report). */
export function salesByCategory(sales: SaleLike[]): Record<SaleCategoryStr, number> {
  const out = {
    FUEL: 0,
    STORE: 0,
    LOTTERY: 0,
    TOBACCO: 0,
    FOOD_DRINK: 0,
    OTHER: 0,
  } as Record<SaleCategoryStr, number>;
  for (const s of sales) out[s.category] += s.amount;
  (Object.keys(out) as SaleCategoryStr[]).forEach((k) => (out[k] = money(out[k])));
  return out;
}

/**
 * Expected cash for a shift = cash sales − cash payouts − cash drops.
 * (Card sales never enter the drawer.) Variance = counted − expected;
 * negative is a shortage, positive an overage (FR-16).
 */
export function shiftReconciliation(input: {
  cashSales: number;
  payouts: number;
  cashDrop: number;
  openCash: number;
  closeCash: number;
}) {
  const expectedCash = money(
    input.openCash + input.cashSales - input.payouts - input.cashDrop
  );
  const variance = money(input.closeCash - expectedCash);
  return { expectedCash, variance };
}

/** Profit margin on a single product/purchase line (FR-22). */
export function purchaseMargin(p: { costEach: number; sellPrice: number }): number {
  if (p.sellPrice === 0) return 0;
  return round(((p.sellPrice - p.costEach) / p.sellPrice) * 100, 2);
}

export interface PnL {
  grossSales: number;
  salesTaxCollected: number;
  refunds: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  profitMargin: number;
  fuelProfit: number;
}

/**
 * Build a complete profit & loss summary for a set of records — the single
 * source of truth used by the dashboard and every report (FR-2, FR-29, FR-33).
 *
 * `storeCOGS` is supplied by the caller (derived from purchases / average cost)
 * so this stays a pure function of its inputs.
 */
export function buildPnL(args: {
  sales: SaleLike[];
  fuelSales: FuelSaleLike[];
  expenses: ExpenseLike[];
  storeCOGS: number;
}): PnL {
  const gross = grossSales(args.sales);
  const tax = salesTaxCollected(args.sales);
  const refunds = totalRefunds(args.sales);
  const net = money(gross - refunds);
  const cogs = money(fuelCOGS(args.fuelSales) + args.storeCOGS);
  const gp = grossProfit(net, cogs);
  const opex = operatingExpenses(args.expenses);
  const np = netProfit(gp, opex);
  return {
    grossSales: gross,
    salesTaxCollected: tax,
    refunds,
    netSales: net,
    cogs,
    grossProfit: gp,
    operatingExpenses: opex,
    netProfit: np,
    profitMargin: profitMargin(gp, net),
    fuelProfit: fuelProfit(args.fuelSales),
  };
}

/** Percentage change vs. a prior period for ▲▼ comparisons (FR-6). */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null; // null = "no baseline"
  return round(((current - previous) / Math.abs(previous)) * 100, 1);
}
