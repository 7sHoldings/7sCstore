/**
 * Shared price-book filter. The page, the "select all matching" action and the
 * bulk-update action all build their `where` clause from here, so what you see
 * on screen is exactly what a bulk change touches.
 */
import type { Prisma } from "@prisma/client";

export interface PriceBookFilter {
  q?: string;
  dept?: string;
  /** Only items priced at or below cost. */
  below?: boolean;
  /** Only items with no cost on file. */
  noCost?: boolean;
  /** Only items with no price on file. */
  noPrice?: boolean;
}

export function readFilter(sp: Record<string, string | undefined>): PriceBookFilter {
  return {
    q: sp.q?.trim() || undefined,
    dept: sp.dept?.trim() || undefined,
    below: sp.flag === "below",
    noCost: sp.flag === "nocost",
    noPrice: sp.flag === "noprice",
  };
}

export function buildWhere(locationId: string | null, f: PriceBookFilter): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = locationId ? { locationId } : {};

  if (f.q) {
    // Match either the product name or the scan code, so an owner can paste a
    // barcode straight from a vendor invoice.
    where.OR = [
      { name: { contains: f.q, mode: "insensitive" } },
      { upc: { contains: f.q, mode: "insensitive" } },
    ];
  }
  if (f.dept) where.department = f.dept;
  if (f.noCost) where.currentCost = { lte: 0 };
  if (f.noPrice) where.sellingPrice = { lte: 0 };
  // `below` (price <= cost) compares two columns, which Prisma can't express in
  // a where clause; the page applies it via raw SQL on the id list instead.

  return where;
}

/** Query-string for a filter, used by the pager and the filter bar. */
export function filterToParams(f: PriceBookFilter, page?: number): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.dept) p.set("dept", f.dept);
  if (f.below) p.set("flag", "below");
  else if (f.noCost) p.set("flag", "nocost");
  else if (f.noPrice) p.set("flag", "noprice");
  if (page && page > 1) p.set("page", String(page));
  return p.toString();
}
