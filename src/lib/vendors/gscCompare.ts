import "server-only";
import { prisma } from "../db";
import { money } from "../calc";
import { priceFromMargin, defaultMargin } from "../pricing";

/**
 * Builds the GSC price-comparison table: the newest vendor cost for each
 * product, the target price its department's margin implies, and whether the
 * current shelf price sits under that floor.
 *
 * The rule is a FLOOR, never a ceiling: a price already at or above target is
 * left alone. Only prices below the floor are raised.
 */

/** Used when a department has no margin set yet. */
export const FALLBACK_MARGIN = 40;

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
  /** Current price is below the floor and should be raised. */
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
 * The margin to price a product at: its department's setting first, then the
 * category default already used elsewhere in the app, then the fallback.
 */
export function resolveMargin(
  department: string | null,
  category: string | null,
  margins: Map<string, number>
): number {
  if (department) {
    const set = margins.get(department);
    if (set != null) return set;
  }
  if (category) return defaultMargin(category);
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
    // A price of 0 means the POS has no price on file — treat it as needing one.
    const needsRaise =
      r.productId != null && currentPrice != null && currentPrice < targetPrice - 0.005;
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
      needsRaise,
      increase: needsRaise && currentPrice != null ? money(targetPrice - currentPrice) : 0,
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
