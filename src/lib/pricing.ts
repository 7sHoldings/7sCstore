/**
 * Retail pricing & cost helpers for inventory.
 *
 * You buy a CASE (e.g. a box of 10 candies or a carton of 10 packs) at a
 * wholesale case cost, and sell individual UNITS at a retail price derived from
 * a target margin. "Margin" here is true gross margin: price = cost / (1 − m),
 * so a $1 unit at 40% margin sells for $1.67 (margin = (1.67 − 1) / 1.67 ≈ 40%).
 */
import { money } from "./calc";

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
