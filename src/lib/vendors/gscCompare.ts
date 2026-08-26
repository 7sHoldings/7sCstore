import "server-only";
import { prisma } from "../db";
import { money } from "../calc";
import { priceFromMargin, defaultMargin } from "../pricing";
import { mapDeptToCategory } from "../integrations/modiMap";

/**
 * Builds the GSC price-comparison table: the newest vendor cost for each
 * product, the target price its department's margin implies, and whether the
 * current shelf price sits under that floor.
 *
 * The rule is a FLOOR, never a ceiling: a price already at or above target is
 * left alone. Only prices below the floor are raised.
 */

/** Used when a department has no margin set and no category default applies. */
export const FALLBACK_MARGIN = 40;

/**
 * House target margins by POS department, as set by the owner.
 *
 * These are defaults, not overrides: anything entered on the Pricing screen
 * wins, so a department can be retuned without a code change. Departments not
 * listed here fall back to the per-category defaults in lib/pricing.ts — which
 * is what keeps cigarettes, cigars and chew on a thin tobacco margin rather
 * than a grocery one.
 *
 * Keys are matched case- and spacing-insensitively.
 */
export const DEFAULT_DEPARTMENT_MARGIN: Record<string, number> = {
  // 40%
  "TAX GRO": 40,
  SODA: 40,
  "NON TAX": 40,
  "NON TAX GRO": 40,
  PROPANE: 40,

  // 45%
  CANDY: 45,
  SNACKS: 45,
  AUTO: 45,
  COFFEE: 45,
  "ENERGY DRINK": 45,
  "ICE CREAM": 45,
  DELI: 45,
  GROCERY: 45,

  // 24%
  BEER: 24,

  // 50%
  MEDICINE: 50,
  "DAIRY FOOD": 50,
  WATER: 50,

  // 60%
  CBD: 60,
};

/** Department names vary in case and spacing between exports. */
const deptKey = (d: string): string => d.trim().toUpperCase().replace(/\s+/g, " ");

/** The house default for a department, or null when there isn't one. */
export function houseMargin(department: string | null | undefined): number | null {
  if (!department) return null;
  const v = DEFAULT_DEPARTMENT_MARGIN[deptKey(department)];
  return v == null ? null : v;
}

/** Which of the three candidate prices ended up winning. */
export type PriceSource = "current" | "srp" | "target";

export interface ResolvedPrice {
  price: number;
  source: PriceSource;
}

/**
 * The pricing rule: take whichever is greatest of the current shelf price, the
 * vendor's suggested retail, and the margin target.
 *
 *   - current price wins  -> nothing changes
 *   - target wins         -> raise to the margin target
 *   - SRP wins            -> raise to the vendor's suggested retail
 *
 * A zero means "not known" and simply never wins: items with no SRP on the
 * order, or with no price in the POS, still resolve from whatever is known.
 * The result is never below the current price, so this can only ever raise.
 */
export function resolveFinalPrice(
  currentPrice: number,
  srp: number,
  targetPrice: number
): ResolvedPrice {
  const current = currentPrice > 0 ? money(currentPrice) : 0;
  const vendor = srp > 0 ? money(srp) : 0;
  const target = targetPrice > 0 ? money(targetPrice) : 0;

  const best = Math.max(current, vendor, target);

  // Ties resolve to "current" so an unchanged price is never reported as a
  // raise; between the other two, the margin target takes precedence.
  if (best <= current) return { price: current, source: "current" };
  if (target >= vendor) return { price: target, source: "target" };
  return { price: vendor, source: "srp" };
}

export interface ComparisonRow {
  upcNorm: string;
  upc: string;
  sku: string;
  description: string;
  orderId: string;
  orderSeq: number;
  unitsPerCase: number;
  sizeLabel: string | null;
  caseCost: number;
  unitCost: number;
  srp: number;
  productId: string | null;
  productName: string | null;
  department: string | null;
  category: string | null;
  currentPrice: number | null;
  /** Target margin applied, from the department (or the fallback). */
  marginPct: number;
  /** Price implied by unit cost at the target margin. */
  targetPrice: number;
  /** The greatest of current price, SRP and target — what the shelf becomes. */
  finalPrice: number;
  /** Which candidate won. "current" means no change is needed. */
  priceSource: PriceSource;
  /** The final price is above the current one, so it should be raised. */
  needsRaise: boolean;
  /** How much the raise would add, 0 when no raise is needed. */
  increase: number;
  /** The target sits above the vendor's own suggested retail — worth a look. */
  aboveSrp: boolean;
  /** No product in the price book carries this scan code. */
  unmatched: boolean;
}

interface RawRow {
  upcNorm: string;
  upc: string;
  sku: string;
  description: string;
  orderId: string;
  orderSeq: number;
  unitsPerCase: number;
  sizeLabel: string | null;
  caseCost: number;
  unitCost: number;
  srp: number;
  productId: string | null;
  productName: string | null;
  department: string | null;
  category: string | null;
  sellingPrice: number | null;
}

/** Department → target margin %, for this location. */
export async function getDepartmentMargins(locationId: string): Promise<Map<string, number>> {
  const rows = await prisma.departmentMargin.findMany({ where: { locationId } });
  return new Map(rows.map((r) => [r.department, r.marginPct]));
}

/**
 * The margin to price a product at, most specific first:
 *   1. a margin set for this department on the Pricing screen
 *   2. the house default for that department
 *   3. the per-category default (this is what keeps tobacco thin)
 *   4. the flat fallback
 */
export function resolveMargin(
  department: string | null,
  category: string | null,
  margins: Map<string, number>
): number {
  if (department) {
    const set = margins.get(department);
    if (set != null) return set;
    const house = houseMargin(department);
    if (house != null) return house;
  }
  if (category) return defaultMargin(category);
  return FALLBACK_MARGIN;
}

/**
 * The margin a department would use with nothing set on the Pricing screen —
 * the house default, else the default for the category the department maps to
 * (so tobacco departments show their thin margin rather than a grocery one).
 */
export function effectiveDefaultMargin(department: string | null): number {
  const house = houseMargin(department);
  if (house != null) return house;
  if (department) return defaultMargin(mapDeptToCategory(department));
  return FALLBACK_MARGIN;
}

export interface CompareFilter {
  /** Only rows whose price is below the floor. */
  needsRaiseOnly?: boolean;
  /** Only rows with no matching product. */
  unmatchedOnly?: boolean;
  department?: string;
  q?: string;
}

/**
 * One row per product, built from the newest order line that mentions it.
 * `DISTINCT ON` picks the highest order first, so uploading the full order
 * history and re-uploading it later both converge on the latest cost.
 */
export async function buildComparison(
  locationId: string,
  filter: CompareFilter = {},
  vendor = "GSC"
): Promise<ComparisonRow[]> {
  const raw = await prisma.$queryRaw<RawRow[]>`
    WITH latest AS (
      SELECT DISTINCT ON (v."upcNorm") v.*
      FROM "VendorOrderLine" v
      WHERE v."locationId" = ${locationId} AND v.vendor = ${vendor}
      ORDER BY v."upcNorm", v."orderSeq" DESC, v."importedAt" DESC, v.id DESC
    )
    SELECT DISTINCT ON (l."upcNorm")
      l."upcNorm", l.upc, l.sku, l.description, l."orderId", l."orderSeq",
      l."unitsPerCase", l."sizeLabel", l."caseCost", l."unitCost", l.srp,
      p.id            AS "productId",
      p.name          AS "productName",
      p.department    AS "department",
      p.category::text AS "category",
      p."sellingPrice" AS "sellingPrice"
    FROM latest l
    LEFT JOIN "Product" p
      ON p."locationId" = ${locationId}
     AND p.upc IS NOT NULL
     AND ltrim(p.upc, '0') = l."upcNorm"
    ORDER BY l."upcNorm", p."sellingPrice" DESC NULLS LAST
  `;

  const margins = await getDepartmentMargins(locationId);

  const rows: ComparisonRow[] = raw.map((r) => {
    const marginPct = resolveMargin(r.department, r.category, margins);
    const targetPrice = priceFromMargin(r.unitCost, marginPct);
    const currentPrice = r.productId ? r.sellingPrice ?? 0 : null;
    const resolved = resolveFinalPrice(currentPrice ?? 0, r.srp, targetPrice);
    const needsRaise =
      r.productId != null && currentPrice != null && resolved.price > currentPrice + 0.005;
    return {
      upcNorm: r.upcNorm,
      upc: r.upc,
      sku: r.sku,
      description: r.description,
      orderId: r.orderId,
      orderSeq: r.orderSeq,
      unitsPerCase: r.unitsPerCase,
      sizeLabel: r.sizeLabel,
      caseCost: r.caseCost,
      unitCost: r.unitCost,
      srp: r.srp,
      productId: r.productId,
      productName: r.productName,
      department: r.department,
      category: r.category,
      currentPrice,
      marginPct,
      targetPrice,
      finalPrice: resolved.price,
      priceSource: resolved.source,
      needsRaise,
      increase: needsRaise && currentPrice != null ? money(resolved.price - currentPrice) : 0,
      aboveSrp: r.srp > 0 && targetPrice > r.srp + 0.005,
      unmatched: r.productId == null,
    };
  });

  return applyFilter(rows, filter);
}

function applyFilter(rows: ComparisonRow[], f: CompareFilter): ComparisonRow[] {
  let out = rows;
  if (f.needsRaiseOnly) out = out.filter((r) => r.needsRaise);
  if (f.unmatchedOnly) out = out.filter((r) => r.unmatched);
  if (f.department) out = out.filter((r) => r.department === f.department);
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    out = out.filter(
      (r) =>
        (r.productName ?? "").toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.upc.includes(q) ||
        r.upcNorm.includes(q) ||
        r.sku.includes(q)
    );
  }
  return out;
}
