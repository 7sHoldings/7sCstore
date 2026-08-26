/**
 * Decide what an incoming price-book row actually changes on a stored product.
 *
 * A POS export routinely carries zeros and blanks that mean "unknown" rather
 * than "zero" — in a real 16k-row Modisoft export, cost was empty on 99.9% of
 * rows and 103 items had no retail price. Writing those through would erase
 * costs entered from vendor invoices, so a falsy incoming value always loses to
 * a stored one. The POS stays authoritative for naming and departments.
 */
import type { PriceBookRow } from "./parse";

export interface StoredProduct {
  name: string;
  category: string;
  department: string | null;
  size: string | null;
  unitsPerCase: number | null;
  posItemCode: string | null;
  sellingPrice: number;
  currentCost: number;
}

/**
 * Fields to write, or an empty object when the row matches what is stored.
 * `price`/`cost` are passed in already rounded to 2 decimals.
 */
export function diffProduct(
  prev: StoredProduct,
  row: PriceBookRow,
  price: number,
  cost: number
): Record<string, unknown> {
  const next: Record<string, unknown> = {};

  // The POS owns naming and departmental structure.
  if (prev.name !== row.name) next.name = row.name;
  if (prev.category !== row.category) next.category = row.category;
  if ((prev.department ?? null) !== (row.department ?? null)) next.department = row.department ?? null;

  // Money: a zero means "not known", never "free".
  if (price > 0 && prev.sellingPrice !== price) next.sellingPrice = price;
  if (cost > 0 && prev.currentCost !== cost) next.currentCost = cost;

  // Optional detail: only ever filled in, never blanked.
  if (row.size && prev.size !== row.size) next.size = row.size;
  if (row.unitsPerCase && row.unitsPerCase > 0 && prev.unitsPerCase !== row.unitsPerCase) {
    next.unitsPerCase = row.unitsPerCase;
  }
  if (row.posItemCode && prev.posItemCode !== row.posItemCode) next.posItemCode = row.posItemCode;

  return next;
}
