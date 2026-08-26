import "server-only";
import { prisma } from "../db";
import { money } from "../calc";

/**
 * Builds a weekly vendor order from measured demand.
 *
 * How demand is measured
 * ----------------------
 * The POS does not maintain stock — on-hand simply decrements from zero as
 * items sell, so its quantity is the negative of a cumulative units-sold
 * counter. The counter's own start date is unknown and irrelevant: the
 * DIFFERENCE between two readings is exactly the units sold in between.
 * `ProductMovement` stores those readings, and velocity is
 *
 *     units per week = (newest.soldUnits - older.soldUnits) / days * 7
 *
 * A negative difference means the POS counter was reset, so that pair is
 * discarded rather than trusted.
 *
 * When there aren't two usable readings yet, the engine falls back to what the
 * owner has historically bought from this vendor — the same judgement they
 * would apply by hand, just applied consistently.
 *
 * What gets ordered
 * -----------------
 *     units needed = units per week x weeks of cover
 *     cases        = ceil(units needed / units per case)
 *
 * Rounding up is deliberate: cases are indivisible, and running out costs a
 * sale while one extra case costs a little cash flow.
 */

/**
 * Weeks of stock an order aims to cover. Ordering is weekly, so one week is the
 * honest baseline: it replaces what actually sold since the last order. Cases
 * round up, which already leaves a little headroom on top. Raise it on the
 * Weekly Order screen to carry more cushion.
 */
export const DEFAULT_COVER_WEEKS = 1;

/** Ignore readings older than this when measuring velocity. */
const VELOCITY_WINDOW_DAYS = 35;
/** A pair of readings closer together than this is too noisy to extrapolate. */
const MIN_SPAN_DAYS = 2;

export interface ReorderOptions {
  /** Weeks of stock the order should cover. */
  coverWeeks?: number;
  /** Don't suggest an item selling less than this per week. */
  minWeeklyUnits?: number;
  /** Cap on cases for any single line, as a guard against bad data. */
  maxCasesPerLine?: number;
  vendor?: string;
}

export interface ReorderLine {
  upcNorm: string;
  sku: string;
  description: string;
  department: string | null;
  unitsPerCase: number;
  caseCost: number;
  /** Measured (or estimated) units sold per week. */
  weeklyUnits: number;
  /** Units the cover period calls for. */
  unitsNeeded: number;
  suggestedCases: number;
  /** Extended cost of the suggested cases. */
  lineCost: number;
  /** How weeklyUnits was arrived at. */
  basis: "velocity" | "order-history";
  /** Days between the two readings used, when basis is "velocity". */
  spanDays: number | null;
  /** Units sold over that span. */
  soldInSpan: number | null;
  /** Cumulative units sold at the most recent reading, for context. */
  lastOrderedCases: number | null;
}

export interface ReorderResult {
  lines: ReorderLine[];
  coverWeeks: number;
  /** Products measured from real readings vs estimated from past orders. */
  fromVelocity: number;
  fromHistory: number;
  /** Readings available — velocity needs at least two. */
  snapshotCount: number;
  newestSnapshot: Date | null;
  totalCost: number;
  notes: string[];
}

interface CatalogRow {
  upcNorm: string;
  sku: string;
  description: string;
  unitsPerCase: number;
  caseCost: number;
  department: string | null;
  /** Average cases per order across the vendor history. */
  avgCasesPerOrder: number;
  /** How many distinct orders this item has appeared on. */
  orderCount: number;
  ordersSpanned: number;
}

/**
 * Everything this vendor sells us, with its newest cost/pack and a summary of
 * how often it has been bought. One row per product.
 */
async function loadCatalog(locationId: string, vendor: string): Promise<CatalogRow[]> {
  return prisma.$queryRaw<CatalogRow[]>`
    WITH latest AS (
      SELECT DISTINCT ON (v."upcNorm")
        v."upcNorm", v.sku, v.description, v."unitsPerCase", v."caseCost"
      FROM "VendorOrderLine" v
      WHERE v."locationId" = ${locationId} AND v.vendor = ${vendor}
      ORDER BY v."upcNorm", v."orderSeq" DESC, v.id DESC
    ),
    stats AS (
      SELECT
        v."upcNorm",
        AVG(v.quantity)                      AS "avgCasesPerOrder",
        COUNT(DISTINCT v."orderId")::int     AS "orderCount",
        (COUNT(DISTINCT v2."orderId"))::int  AS "ordersSpanned"
      FROM "VendorOrderLine" v
      CROSS JOIN LATERAL (
        SELECT DISTINCT o."orderId"
        FROM "VendorOrderLine" o
        WHERE o."locationId" = v."locationId" AND o.vendor = v.vendor
      ) v2
      WHERE v."locationId" = ${locationId} AND v.vendor = ${vendor} AND v.quantity > 0
      GROUP BY v."upcNorm"
    )
    SELECT
      l."upcNorm", l.sku, l.description, l."unitsPerCase", l."caseCost",
      p.department AS department,
      COALESCE(s."avgCasesPerOrder", 0)::float AS "avgCasesPerOrder",
      COALESCE(s."orderCount", 0)              AS "orderCount",
      COALESCE(s."ordersSpanned", 0)           AS "ordersSpanned"
    FROM latest l
    LEFT JOIN stats s ON s."upcNorm" = l."upcNorm"
    LEFT JOIN "Product" p
      ON p."locationId" = ${locationId}
     AND p.upc IS NOT NULL
     AND ltrim(p.upc, '0') = l."upcNorm"
  `;
}

interface VelocityRow {
  upcNorm: string;
  soldInSpan: number;
  spanDays: number;
  latestSold: number;
}

/**
 * Units sold per product between the newest reading and the oldest reading
 * still inside the window. Pairs where the counter went backwards (a POS
 * reset) are dropped by the `>= 0` guard.
 */
async function loadVelocity(locationId: string, since: Date): Promise<Map<string, VelocityRow>> {
  const rows = await prisma.$queryRaw<VelocityRow[]>`
    WITH bounds AS (
      SELECT
        "upcNorm",
        MAX("takenAt") AS newest,
        MIN("takenAt") AS oldest
      FROM "ProductMovement"
      WHERE "locationId" = ${locationId} AND "takenAt" >= ${since}
      GROUP BY "upcNorm"
      HAVING MAX("takenAt") > MIN("takenAt")
    )
    SELECT
      b."upcNorm",
      (mNew."soldUnits" - mOld."soldUnits")::float                         AS "soldInSpan",
      EXTRACT(EPOCH FROM (b.newest - b.oldest)) / 86400.0                  AS "spanDays",
      mNew."soldUnits"::float                                              AS "latestSold"
    FROM bounds b
    JOIN "ProductMovement" mNew
      ON mNew."locationId" = ${locationId} AND mNew."upcNorm" = b."upcNorm" AND mNew."takenAt" = b.newest
    JOIN "ProductMovement" mOld
      ON mOld."locationId" = ${locationId} AND mOld."upcNorm" = b."upcNorm" AND mOld."takenAt" = b.oldest
    WHERE mNew."soldUnits" - mOld."soldUnits" >= 0
  `;
  return new Map(rows.map((r) => [r.upcNorm, r]));
}

export async function buildReorder(
  locationId: string,
  opts: ReorderOptions = {}
): Promise<ReorderResult> {
  const coverWeeks = opts.coverWeeks ?? DEFAULT_COVER_WEEKS;
  const minWeeklyUnits = opts.minWeeklyUnits ?? 0.5;
  const maxCasesPerLine = opts.maxCasesPerLine ?? 40;
  const vendor = opts.vendor ?? "GSC";

  const since = new Date();
  since.setDate(since.getDate() - VELOCITY_WINDOW_DAYS);

  const [catalog, velocity, snapshotDays] = await Promise.all([
    loadCatalog(locationId, vendor),
    loadVelocity(locationId, since),
    prisma.productMovement.findMany({
      where: { locationId },
      distinct: ["takenAt"],
      select: { takenAt: true },
      orderBy: { takenAt: "desc" },
      take: 60,
    }),
  ]);

  const notes: string[] = [];
  const lines: ReorderLine[] = [];
  let fromVelocity = 0;
  let fromHistory = 0;

  for (const c of catalog) {
    const perCase = c.unitsPerCase > 0 ? c.unitsPerCase : 1;
    let weeklyUnits = 0;
    let basis: ReorderLine["basis"] = "order-history";
    let spanDays: number | null = null;
    let soldInSpan: number | null = null;

    const v = velocity.get(c.upcNorm);
    if (v && v.spanDays >= MIN_SPAN_DAYS) {
      weeklyUnits = (v.soldInSpan / v.spanDays) * 7;
      basis = "velocity";
      spanDays = Math.round(v.spanDays * 10) / 10;
      soldInSpan = v.soldInSpan;
    } else if (c.orderCount > 0 && c.ordersSpanned > 0) {
      // No usable readings yet: assume the historical buying rate. Ordering
      // weekly, an item bought on k of the last n orders at q cases each
      // averages (k/n * q) cases a week.
      const casesPerOrder = c.avgCasesPerOrder || 0;
      const frequency = Math.min(1, c.orderCount / c.ordersSpanned);
      weeklyUnits = casesPerOrder * frequency * perCase;
    }

    if (weeklyUnits < minWeeklyUnits) continue;

    const unitsNeeded = weeklyUnits * coverWeeks;
    let suggestedCases = Math.ceil(unitsNeeded / perCase);
    if (suggestedCases <= 0) continue;
    if (suggestedCases > maxCasesPerLine) {
      suggestedCases = maxCasesPerLine;
      notes.push(`${c.description || c.sku} capped at ${maxCasesPerLine} cases.`);
    }

    if (basis === "velocity") fromVelocity++;
    else fromHistory++;

    lines.push({
      upcNorm: c.upcNorm,
      sku: c.sku,
      description: c.description,
      department: c.department,
      unitsPerCase: perCase,
      caseCost: c.caseCost,
      weeklyUnits: Math.round(weeklyUnits * 100) / 100,
      unitsNeeded: Math.round(unitsNeeded * 100) / 100,
      suggestedCases,
      lineCost: money(suggestedCases * c.caseCost),
      basis,
      spanDays,
      soldInSpan,
      lastOrderedCases: c.avgCasesPerOrder > 0 ? Math.round(c.avgCasesPerOrder * 10) / 10 : null,
    });
  }

  // Busiest first — that's the order the owner wants to eyeball.
  lines.sort((a, b) => b.weeklyUnits - a.weeklyUnits);

  const snapshotCount = snapshotDays.length;
  if (snapshotCount < 2) {
    notes.unshift(
      "Only one inventory reading so far, so quantities come from past orders. " +
        "Pull inventory again and the next order will use measured sales."
    );
  }

  return {
    lines,
    coverWeeks,
    fromVelocity,
    fromHistory,
    snapshotCount,
    newestSnapshot: snapshotDays[0]?.takenAt ?? null,
    totalCost: money(lines.reduce((s, l) => s + l.lineCost, 0)),
    notes: notes.slice(0, 20),
  };
}
