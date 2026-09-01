/**
 * Retail pricing & cost helpers for inventory.
 *
 * You buy a CASE (e.g. a box of 10 candies or a carton of 10 packs) at a
 * wholesale case cost, and sell individual UNITS at a retail price derived from
 * a target margin. "Margin" here is true gross margin: price = cost / (1 − m),
 * so a $1 unit at 40% margin sells for $1.67 (margin = (1.67 − 1) / 1.67 ≈ 40%).
 */
import { money, round } from "./calc";

// Default target margin (%) per sale category. Tobacco/cigars run thin and are
// often minimum-priced; fuel & lottery are pass-through (price set elsewhere).
export const CATEGORY_MARGIN: Record<string, number> = {
  STORE: 40,
  FOOD_DRINK: 40,
  TOBACCO: 8,
  OTHER: 35,
  LOTTERY: 0,
  FUEL: 0,
};

export function defaultMargin(category: string): number {
  return CATEGORY_MARGIN[category] ?? 40;
}

/** Unit cost = case cost ÷ units per case. */
export function unitCostFromCase(caseCost: number, unitsPerCase: number): number {
  const units = unitsPerCase > 0 ? unitsPerCase : 1;
  return money(caseCost / units);
}

/** Retail unit price from unit cost at a target gross margin (%). */
export function priceFromMargin(unitCost: number, marginPct: number): number {
  const m = Math.min(Math.max(marginPct, 0), 95) / 100;
  return money(unitCost / (1 - m));
}

/** Actual margin (%) implied by a cost/price pair. */
export function marginOf(unitCost: number, price: number): number {
  if (price <= 0) return 0;
  return Math.round(((price - unitCost) / price) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Shelf-friendly price endings
// ---------------------------------------------------------------------------

/** Optional rounding applied after a price is derived from cost + margin. */
export type RoundRule = "none" | "nickel" | "dime" | "end99";

export const ROUND_RULES: { value: RoundRule; label: string }[] = [
  { value: "none", label: "No rounding" },
  { value: "nickel", label: "Nearest $0.05" },
  { value: "dime", label: "Nearest $0.10" },
  { value: "end99", label: "Round up to .99" },
];

/**
 * Snap a price to a shelf-friendly ending. `priceFromMargin` yields exact
 * figures like $1.67 — real stores price at $1.69 or $1.99. Rounding is applied
 * after the margin math, so the resulting margin is at least the target for
 * `end99` (which only ever rounds up) and within a few cents for the others.
 * Never returns a negative price.
 */
export function applyRounding(price: number, rule: RoundRule): number {
  const p = money(price);
  if (p <= 0) return 0;
  switch (rule) {
    case "nickel":
      return money(Math.round(p / 0.05) * 0.05);
    case "dime":
      return money(Math.round(p / 0.1) * 0.1);
    case "end99":
      // Next price ending in .99 at or above p (2.34 -> 2.99, 2.99 stays 2.99).
      // The epsilon stops an exact .99 being pushed up a whole dollar.
      return money(Math.max(0.99, Math.ceil(p - 0.99 - 1e-9) + 0.99));
    default:
      return p;
  }
}

/** Retail price from unit cost at a target margin, snapped to a price ending. */
export function priceFromMarginRounded(
  unitCost: number,
  marginPct: number,
  rule: RoundRule = "none"
): number {
  return applyRounding(priceFromMargin(unitCost, marginPct), rule);
}

// ---------------------------------------------------------------------------
// Price book: reading a price, and changing many at once
// ---------------------------------------------------------------------------
// Merged in from the price-book branch. Its own copies of RoundRule,
// ROUND_RULES and applyRounding were identical to the ones above, so only what
// is genuinely new lands here — the two files were the same maths approached
// from opposite ends: derive a price from cost, or move prices that exist.

/** How a bulk change reinterprets the current selling price. */
export type BulkMode = "pct" | "amount" | "set";

export const BULK_MODES: { value: BulkMode; label: string; hint: string }[] = [
  { value: "pct", label: "Change by %", hint: "e.g. 5 raises prices 5%, -5 lowers them 5%" },
  { value: "amount", label: "Change by $", hint: "e.g. 0.25 adds a quarter, -0.25 takes one off" },
  { value: "set", label: "Set price to", hint: "Every selected item gets this exact price" },
];

/**
 * Gross margin as a percentage of the retail price: (price − cost) / price.
 * Null when the item has no selling price yet — margin is undefined, not 0%.
 */
export function marginPct(cost: number, price: number): number | null {
  if (!price) return null;
  return round(((price - cost) / price) * 100, 1);
}

/** Markup over cost: (price − cost) / cost. Null when there is no cost basis. */
export function markupPct(cost: number, price: number): number | null {
  if (!cost) return null;
  return round(((price - cost) / cost) * 100, 1);
}

/** Priced at or below what it cost — the item loses money on every sale. */
export function isBelowCost(cost: number, price: number): boolean {
  return price > 0 && cost > 0 && price <= cost;
}

/** Margin shown as a plain percentage (no +/− trend sign, unlike fmtPct). */
export function fmtMargin(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

/**
 * The new selling price for one item under a bulk change. Results are clamped
 * at 0 — a percentage or dollar cut can never drive a price negative.
 */
export function applyBulkPrice(
  currentPrice: number,
  mode: BulkMode,
  value: number,
  rounding: RoundRule = "none"
): number {
  if (!isFinite(value)) return money(currentPrice);
  let next: number;
  switch (mode) {
    case "pct":
      next = currentPrice * (1 + value / 100);
      break;
    case "amount":
      next = currentPrice + value;
      break;
    case "set":
      next = value;
      break;
    default:
      next = currentPrice;
  }
  if (!isFinite(next) || next < 0) next = 0;
  return applyRounding(next, rounding);
}
