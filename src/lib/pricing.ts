/**
 * Store pricing helpers — retail margin math and the bulk price-change rules
 * behind the price book (`/pricing`).
 *
 * Pure functions with no DB or React dependency, so the table preview (client),
 * the page summary (server), and the bulk update action all derive exactly the
 * same new price. Money keeps 2 decimals via the shared calc engine (NFR-2).
 */

import { money, round } from "./calc";

/** How a bulk change reinterprets the current selling price. */
export type BulkMode = "pct" | "amount" | "set";

/** Optional price-ending rule applied after the change (shelf-friendly prices). */
export type RoundRule = "none" | "nickel" | "dime" | "end99";

export const BULK_MODES: { value: BulkMode; label: string; hint: string }[] = [
  { value: "pct", label: "Change by %", hint: "e.g. 5 raises prices 5%, -5 lowers them 5%" },
  { value: "amount", label: "Change by $", hint: "e.g. 0.25 adds a quarter, -0.25 takes one off" },
  { value: "set", label: "Set price to", hint: "Every selected item gets this exact price" },
];

export const ROUND_RULES: { value: RoundRule; label: string }[] = [
  { value: "none", label: "No rounding" },
  { value: "nickel", label: "Nearest $0.05" },
  { value: "dime", label: "Nearest $0.10" },
  { value: "end99", label: "Round up to .99" },
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

/** Apply a price-ending rule. Never returns a negative price. */
export function applyRounding(price: number, rule: RoundRule): number {
  const p = money(price);
  if (p <= 0) return 0;
  switch (rule) {
    case "nickel":
      return money(Math.round(p / 0.05) * 0.05);
    case "dime":
      return money(Math.round(p / 0.1) * 0.1);
    case "end99":
      // Next price ending in .99 at or above p (2.34 → 2.99, 2.99 → 2.99).
      // The epsilon keeps an exact .99 from being pushed up a whole dollar.
      return money(Math.max(0.99, Math.ceil(p - 0.99 - 1e-9) + 0.99));
    default:
      return p;
  }
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
