import "server-only";
import { prisma } from "../db";
import { money } from "../calc";
import { ORDER_VERSIONS, type VersionKey } from "./orderVersions";

// Re-exported so server callers can keep importing from one place.
export { ORDER_VERSIONS };
export type { VersionKey };

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

/**
 * A product has to sell at least this many units a week to be reordered.
 * Selling one every couple of weeks means the stock already on the shelf is
 * the order.
 */
export const DEFAULT_MIN_WEEKLY_UNITS = 1;

/**
 * Even a product that clears the rate test is skipped when a single case would
 * sit for longer than this. A case of 12 for something selling one a week is
 * three months of stock — case size, not just sales rate, decides.
 */
export const DEFAULT_MAX_WEEKS_OF_STOCK = 6;

/** Weeks of sales history the forecast reads. */
export const DEFAULT_DEMAND_WEEKS = 6;

/**
 * A suggestion may exceed what is normally ordered by at most this factor.
 * Demand can genuinely grow, but leaping far past every previous order for a
 * product is far more often a measurement artefact than real growth — and the
 * cost of being wrong is stock that sits.
 */
export const DEFAULT_SPIKE_GUARD = 1.5;

/**
 * An order may not exceed this multiple of a normal one.
 *
 * Every per-line rule can still be satisfied while the total lands somewhere
 * absurd — a bad sales feed produced an order at nearly ten times normal spend,
 * with each individual line looking defensible. This is the backstop: the order
 * is trimmed smallest-value-first until it fits, and what was dropped is
 * reported rather than quietly removed. Nothing here replaces fixing the data;
 * it exists so bad data cannot turn into a purchase.
 */
export const MAX_ORDER_MULTIPLE = 2;



/** Ignore readings older than this when measuring velocity. */
const VELOCITY_WINDOW_DAYS = 35;
/** A pair of readings closer together than this is too noisy to extrapolate. */
const MIN_SPAN_DAYS = 2;

export interface ReorderOptions {
  /** What a normal order costs, used as the ceiling for the whole order. */
  typicalOrderCost?: number | null;
  /** Weeks of stock the order should cover. */
  coverWeeks?: number;
  /**
   * Slow-mover cut-off. An item has to sell at least this many units a week to
   * be worth a case. Selling one every few weeks means the case already on the
   * shelf is the order.
   */
  minWeeklyUnits?: number;
  /** Skip when one case would sit longer than this many weeks. */
  maxWeeksOfStock?: number;
  /** How many recent weeks of sales to read. */
  demandWeeks?: number;
  /**
   * How far above the historical order quantity a suggestion may go. 1.5 means
   * "at most half again what you normally buy".
   */
  spikeGuard?: number;
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
  /** How weeklyUnits was arrived at, best first. */
  basis: "measured" | "imported" | "velocity" | "order-history";
  /** Units actually sold over the measured window, when there is one. */
  soldInWindow: number | null;
  /** Length of that window in days. */
  windowDays: number | null;
  /** Units sold in each recent week, oldest first. */
  weeklySeries: number[];
  /** How many of those weeks had any sales at all. */
  weeksWithSales: number;
  /** Cases normally bought per order, from past orders. */
  typicalCases: number | null;
  /** The suggestion was trimmed to stay near past orders. */
  cappedByHistory: boolean;
  /** The average week, for comparison with the median actually used. */
  spikeMean: number;
  /** Units delivered by this vendor across the history window. */
  receivedUnits: number;
  /** Units sold across the same window. */
  soldInHistory: number;
  /** Estimated units still on the shelf: delivered minus sold, floored at 0. */
  onHand: number;
  /** True when deliveries are on file, so the shelf figure means something. */
  shelfKnown: boolean;
  /** Units the cover period calls for before the shelf is subtracted. */
  grossUnits: number;
  /** Cases under each version, so the order can be resized without rebuilding. */
  casesFull: number;
  casesBalanced: number;
  casesLean: number;
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
  /** How many lines came from each signal. */
  fromMeasured: number;
  fromVelocity: number;
  fromHistory: number;
  /** Products that sell, but too slowly to justify a case this week. */
  skippedSlow: number;
  /** Lines trimmed to stay in line with past orders. */
  historyCapped: number;
  /** The POS returned a running total instead of weekly sales, so it was refused. */
  demandLooksCumulative: boolean;
  /** Lines held back to keep the order within reach of a normal one. */
  trimmedToBudget: number;
  /** The ceiling applied, when one was. */
  budgetCeiling: number | null;
  /** Products skipped because the shelf already covers the period. */
  coveredByShelf: number;
  /** Cost of each version, so all three can be compared before choosing. */
  versionTotals: Record<VersionKey, { lines: number; cost: number }>;
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

interface WeeklyRow {
  upcNorm: string;
  periodStart: Date;
  soldUnits: number;
}

export interface DemandSeries {
  /** One value per recent week, oldest first, zeros filled in. */
  weeks: number[];
  /** Robust weekly estimate — the median, not the average. */
  median: number;
  /** Plain average, kept only to show how far a spike moved things. */
  mean: number;
  /** Weeks in which the product sold anything at all. */
  weeksWithSales: number;
}

/**
 * Weekly sales per product, as a short series.
 *
 * The median is the forecast, deliberately. An average is moved by one unusual
 * week — a customer clearing the shelf once reads as steady demand and gets
 * reordered forever. A median asks "what does a normal week look like", so a
 * single spike is discarded: [10, 0, 0, 0] has a median of 0 and is not
 * reordered, while [10, 10, 10, 10] has a median of 10 and is.
 */
async function loadDemand(
  locationId: string,
  weeks: number
): Promise<{ series: Map<string, DemandSeries>; periods: Date[] }> {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - weeks * 7);

  const rows = await prisma.$queryRaw<WeeklyRow[]>`
    SELECT "upcNorm", "periodStart", "soldUnits"
    FROM "ProductDemand"
    WHERE "locationId" = ${locationId}
      AND "periodStart" >= ${cutoff}
      AND "periodDays" = 7
  `;

  const periodKeys = [...new Set(rows.map((r) => new Date(r.periodStart).getTime()))].sort();
  const periods = periodKeys.map((t) => new Date(t));
  const index = new Map(periodKeys.map((t, i) => [t, i]));

  const byProduct = new Map<string, number[]>();
  for (const r of rows) {
    const i = index.get(new Date(r.periodStart).getTime());
    if (i === undefined) continue;
    let arr = byProduct.get(r.upcNorm);
    if (!arr) {
      arr = new Array(periodKeys.length).fill(0);
      byProduct.set(r.upcNorm, arr);
    }
    arr[i] = r.soldUnits;
  }

  const series = new Map<string, DemandSeries>();
  for (const [upcNorm, weeksArr] of byProduct) {
    series.set(upcNorm, {
      weeks: weeksArr,
      median: median(weeksArr),
      mean: weeksArr.reduce((a, b) => a + b, 0) / (weeksArr.length || 1),
      weeksWithSales: weeksArr.filter((v) => v > 0).length,
    });
  }

  return { series, periods };
}

/**
 * True when the weekly figures look like a running total rather than per-week
 * sales.
 *
 * The POS report accepts a date range but its quantity column is a stock level,
 * so if it ignores those dates every week comes back carrying the same lifetime
 * figure. A median of six identical lifetime totals then becomes the weekly
 * forecast, and a product that has sold 3,557 units since the counter started
 * gets ordered as 3,557 a week.
 *
 * Real sales vary. Identical values across every week, for most of the
 * catalogue, means the dates were ignored — so the data is refused rather than
 * forecast from.
 */
export function looksCumulative(series: Map<string, DemandSeries>): boolean {
  let flat = 0;
  let considered = 0;
  for (const s of series.values()) {
    if (s.weeks.length < 3) continue;
    const nonZero = s.weeks.filter((v) => v > 0);
    if (nonZero.length < 3) continue;
    considered++;
    if (nonZero.every((v) => v === nonZero[0])) flat++;
  }
  // A handful of steady sellers can genuinely be flat; most of the shop cannot.
  return considered >= 20 && flat / considered > 0.5;
}

/** Middle value; the mean of the two middle values for an even count. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

interface ShelfRow {
  upcNorm: string;
  /** Units received from this vendor across the history window. */
  receivedUnits: number;
  /** Units sold across the same window, per the POS. */
  soldUnits: number;
  historyDays: number;
}

/**
 * Estimate what is still sitting on the shelf.
 *
 * An uploaded vendor order is a delivery that reached the store, so over any
 * stretch of time:
 *
 *     still on the shelf  ≈  units delivered  −  units sold
 *
 * Floored at zero, because selling more than was delivered in the window simply
 * means stock that was already there covered the difference — it can never mean
 * negative shelf stock. Opening stock is unknown, which is exactly why the
 * window is long: over six months, deliveries and sales dominate whatever was
 * on the shelf at the start.
 *
 * Only orders carrying a date can be counted, since deliveries and sales have
 * to describe the same stretch of time to be subtracted from one another.
 */
interface ImportedDemand {
  periodStart: Date;
  periodDays: number;
  /** upcNorm -> units sold across the whole period. */
  sold: Map<string, number>;
}

/**
 * Sales from an uploaded Modisoft Inventory export.
 *
 * The export states a total for one long stretch rather than a week-by-week
 * series, so the forecast is that total spread evenly:
 *
 *     units per week = soldUnits / (periodDays / 7)
 *
 * Averaging is safe here in a way it is not over four weekly readings. A single
 * customer clearing a shelf is a large share of one week but a rounding error
 * across six months, so the long window absorbs the spike the median was
 * protecting against.
 *
 * Only the newest export is used. Two overlapping uploads would double-count.
 */
async function loadImportedDemand(locationId: string): Promise<ImportedDemand | null> {
  const latest = await prisma.productDemand.findFirst({
    where: { locationId, periodDays: { gt: 7 } },
    orderBy: { periodStart: "desc" },
    select: { periodStart: true, periodDays: true },
  });
  if (!latest) return null;

  const rows = await prisma.productDemand.findMany({
    where: { locationId, periodStart: latest.periodStart, periodDays: latest.periodDays },
    select: { upcNorm: true, soldUnits: true },
  });
  if (rows.length === 0) return null;

  return {
    periodStart: latest.periodStart,
    periodDays: latest.periodDays,
    sold: new Map(rows.map((r) => [r.upcNorm, r.soldUnits])),
  };
}

async function loadShelf(locationId: string, vendor: string): Promise<Map<string, ShelfRow>> {
  const rows = await prisma.$queryRaw<ShelfRow[]>`
    WITH hist AS (
      SELECT "periodStart" AS start, "periodDays" AS days
      FROM "ProductDemand"
      WHERE "locationId" = ${locationId} AND "periodDays" > 7
      ORDER BY "periodStart" DESC
      LIMIT 1
    ),
    received AS (
      SELECT v."upcNorm",
             SUM(v.quantity * GREATEST(v."unitsPerCase", 1))::float AS "receivedUnits"
      FROM "VendorOrderLine" v, hist w
      WHERE v."locationId" = ${locationId}
        AND v.vendor = ${vendor}
        AND v."orderedAt" IS NOT NULL
        AND v."orderedAt" >= w.start
      GROUP BY v."upcNorm"
    ),
    sold AS (
      SELECT d."upcNorm", d."soldUnits"::float AS "soldUnits", d."periodDays" AS "historyDays"
      FROM "ProductDemand" d, hist w
      WHERE d."locationId" = ${locationId} AND d."periodStart" = w.start AND d."periodDays" = w.days
    )
    SELECT COALESCE(r."upcNorm", s."upcNorm")     AS "upcNorm",
           COALESCE(r."receivedUnits", 0)          AS "receivedUnits",
           COALESCE(s."soldUnits", 0)              AS "soldUnits",
           COALESCE(s."historyDays", 0)::int       AS "historyDays"
    FROM received r
    FULL OUTER JOIN sold s ON s."upcNorm" = r."upcNorm"
  `;
  return new Map(rows.map((r) => [r.upcNorm, r]));
}

export async function buildReorder(
  locationId: string,
  opts: ReorderOptions = {}
): Promise<ReorderResult> {
  const coverWeeks = opts.coverWeeks ?? DEFAULT_COVER_WEEKS;
  const minWeeklyUnits = opts.minWeeklyUnits ?? DEFAULT_MIN_WEEKLY_UNITS;
  const maxWeeksOfStock = opts.maxWeeksOfStock ?? DEFAULT_MAX_WEEKS_OF_STOCK;
  const maxCasesPerLine = opts.maxCasesPerLine ?? 40;
  const vendor = opts.vendor ?? "GSC";
  const demandWeeks = opts.demandWeeks ?? DEFAULT_DEMAND_WEEKS;
  const spikeGuard = opts.spikeGuard ?? DEFAULT_SPIKE_GUARD;
  const typicalOrderCost = opts.typicalOrderCost ?? (await medianOrderCost(locationId, vendor));

  const since = new Date();
  since.setDate(since.getDate() - VELOCITY_WINDOW_DAYS);

  const [catalog, demandData, shelf, velocity, imported, snapshotDays] = await Promise.all([
    loadCatalog(locationId, vendor),
    loadDemand(locationId, demandWeeks),
    loadShelf(locationId, vendor),
    loadVelocity(locationId, since),
    loadImportedDemand(locationId),
    prisma.productMovement.findMany({
      where: { locationId },
      distinct: ["takenAt"],
      select: { takenAt: true },
      orderBy: { takenAt: "desc" },
      take: 60,
    }),
  ]);

  const demand = demandData.series;
  // Refuse a dataset that is a running total wearing weekly clothing. Ordering
  // from it would buy a lifetime of stock in one week.
  const cumulative = looksCumulative(demand);
  const demandPeriods = cumulative ? 0 : demandData.periods.length;

  const notes: string[] = [];
  if (cumulative) {
    notes.unshift(
      "The POS returned the same figure for every week, which means it ignored the date " +
        "range and reported a running total rather than weekly sales. That data was discarded " +
        "— quantities below come from past orders instead. Ordering from it would have bought " +
        "a lifetime of stock in one week."
    );
  }
  const lines: ReorderLine[] = [];
  let fromMeasured = 0;
  let fromVelocity = 0;
  let fromHistory = 0;
  let skippedSlow = 0;
  let historyCapped = 0;
  let coveredByShelf = 0;

  for (const c of catalog) {
    const perCase = c.unitsPerCase > 0 ? c.unitsPerCase : 1;
    let weeklyUnits = 0;
    let basis: ReorderLine["basis"] = "order-history";
    let spanDays: number | null = null;
    let soldInSpan: number | null = null;
    let soldInWindow: number | null = null;
    let windowDays: number | null = null;
    let weeklySeries: number[] = [];
    let weeksWithSales = 0;
    let spikeMean = 0;

    // Best signal: units the POS reports sold over a recent window. Selling 40
    // in 28 days forecasts 10 a week, so next week's order is 10 units' worth.
    const d = demand.get(c.upcNorm);
    const v = velocity.get(c.upcNorm);

    if (demandPeriods > 0) {
      // Sales history has been pulled, so it is authoritative — including for a
      // product that appears nowhere in it, which sold nothing. Falling back to
      // past orders here would reorder items that are not selling at all.
      //
      // The MEDIAN week is the forecast, not the average: one customer clearing
      // the shelf shows up in a single week, and a median discards it.
      weeklyUnits = d ? d.median : 0;
      basis = "measured";
      soldInWindow = d ? d.weeks.reduce((a, b) => a + b, 0) : 0;
      windowDays = demandPeriods * 7;
      weeklySeries = d ? d.weeks : [];
      weeksWithSales = d ? d.weeksWithSales : 0;
      spikeMean = d ? Math.round(d.mean * 100) / 100 : 0;
    } else if (imported) {
      // An uploaded export is authoritative the same way a pull is: it lists
      // every product, so a product missing from it sold nothing, and falling
      // back to past orders would reorder what is not selling.
      const sold = imported.sold.get(c.upcNorm) ?? 0;
      weeklyUnits = sold / (imported.periodDays / 7);
      basis = "imported";
      soldInWindow = sold;
      windowDays = imported.periodDays;
    } else if (v && v.spanDays >= MIN_SPAN_DAYS) {
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

    // Slow movers are deliberately left off. If an item sells one unit every
    // couple of weeks, a fresh case is money sitting on the shelf — the stock
    // already there is the order. Only real sellers get replaced.
    if (weeklyUnits < minWeeklyUnits) {
      skippedSlow++;
      continue;
    }

    // Case size matters as much as the rate: one case of 12 for a product
    // selling one a week is three months of stock sitting on the shelf.
    const weeksPerCase = perCase / weeklyUnits;
    if (weeksPerCase > maxWeeksOfStock) {
      skippedSlow++;
      continue;
    }

    // What the cover period calls for, less what is already on the shelf.
    // Ordering the full forecast while stock is still sitting there is how a
    // shelf ends up with three months of a product on it.
    const sh = shelf.get(c.upcNorm);
    const onHand = sh ? Math.max(0, sh.receivedUnits - sh.soldUnits) : 0;
    const shelfKnown = !!sh && sh.receivedUnits > 0;

    const grossUnits = weeklyUnits * coverWeeks;
    const unitsNeeded = Math.max(0, grossUnits - onHand);

    if (unitsNeeded <= 0) {
      coveredByShelf++;
      continue;
    }

    // Past orders bound every version: a forecast leaping far beyond each
    // previous order for a product is more often an artefact than real growth,
    // and being wrong means stock that sits. Growth is allowed, not in one jump.
    const typical = c.avgCasesPerOrder;
    const ceiling = typical > 0 ? Math.max(1, Math.ceil(typical * spikeGuard)) : Infinity;

    /** Cases for one version, given its slice of the cover period. */
    const casesFor = (multiplier: number): { cases: number; capped: boolean } => {
      const need = Math.max(0, weeklyUnits * coverWeeks * multiplier - onHand);
      let n = Math.ceil(need / perCase);
      if (n <= 0) return { cases: 0, capped: false };
      let capped = false;
      if (n > ceiling) { n = ceiling; capped = true; }
      if (n > maxCasesPerLine) n = maxCasesPerLine;
      return { cases: n, capped };
    };

    const full = casesFor(1);
    const balanced = casesFor(ORDER_VERSIONS[1].coverMultiplier);
    const lean = casesFor(ORDER_VERSIONS[2].coverMultiplier);

    let suggestedCases = full.cases;
    if (suggestedCases <= 0) continue;
    const cappedByHistory = full.capped;
    if (cappedByHistory) historyCapped++;

    if (basis === "measured" || basis === "imported") fromMeasured++;
    else if (basis === "velocity") fromVelocity++;
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
      soldInWindow,
      windowDays,
      weeklySeries,
      weeksWithSales,
      typicalCases: typical > 0 ? Math.round(typical * 10) / 10 : null,
      cappedByHistory,
      spikeMean,
      receivedUnits: sh ? Math.round(sh.receivedUnits * 10) / 10 : 0,
      soldInHistory: sh ? Math.round(sh.soldUnits * 10) / 10 : 0,
      onHand: Math.round(onHand * 10) / 10,
      shelfKnown,
      grossUnits: Math.round(grossUnits * 100) / 100,
      casesFull: full.cases,
      casesBalanced: balanced.cases,
      casesLean: lean.cases,
      lastOrderedCases: c.avgCasesPerOrder > 0 ? Math.round(c.avgCasesPerOrder * 10) / 10 : null,
    });
  }

  // Busiest first — that's the order the owner wants to eyeball.
  lines.sort((a, b) => b.weeklyUnits - a.weeklyUnits);

  // Backstop: keep the whole order within reach of a normal one. Per-line rules
  // can all pass while the total is still far beyond anything ever spent.
  let trimmedToBudget = 0;
  let budgetCeiling: number | null = null;
  if (typicalOrderCost && typicalOrderCost > 0) {
    budgetCeiling = money(typicalOrderCost * MAX_ORDER_MULTIPLE);
    let running = lines.reduce((sum, l) => sum + l.lineCost, 0);
    if (running > budgetCeiling) {
      // Drop the least valuable lines first, so the fastest movers survive.
      const bySmallest = [...lines].sort((a, b) => a.lineCost - b.lineCost);
      const dropped = new Set<string>();
      for (const l of bySmallest) {
        if (running <= budgetCeiling) break;
        dropped.add(l.upcNorm);
        running -= l.lineCost;
        trimmedToBudget++;
      }
      for (let i = lines.length - 1; i >= 0; i--) {
        if (dropped.has(lines[i].upcNorm)) lines.splice(i, 1);
      }
      notes.unshift(
        `This order came to more than ${MAX_ORDER_MULTIPLE}x a normal one, so ` +
          `${trimmedToBudget} of the smallest lines were held back to bring it within ` +
          `${money(budgetCeiling).toLocaleString()}. That usually means the sales data is wrong — ` +
          `check the figures before ordering.`
      );
    }
  }

  const snapshotCount = snapshotDays.length;
  if (fromMeasured === 0 && snapshotCount < 2) {
    notes.unshift(
      "No sales history pulled yet, so quantities come from what you have bought before. " +
        "Pull sales history and the order will be forecast from what actually sold."
    );
  }
  if (coveredByShelf > 0) {
    notes.push(
      `${coveredByShelf} product${coveredByShelf === 1 ? " is" : "s are"} already covered by ` +
        `stock on the shelf — delivered but not yet sold — so nothing was ordered for them.`
    );
  }
  if (historyCapped > 0) {
    notes.push(
      `${historyCapped} line${historyCapped === 1 ? "" : "s"} trimmed to stay within ` +
        `${spikeGuard}x what you normally order — a one-off week shouldn't set the quantity.`
    );
  }
  if (skippedSlow > 0) {
    notes.push(
      `${skippedSlow} slow-moving product${skippedSlow === 1 ? "" : "s"} left off — ` +
        `each sells under ${minWeeklyUnits} a week, or one case would last over ` +
        `${maxWeeksOfStock} weeks — what's on the shelf covers it.`
    );
  }

  return {
    lines,
    coverWeeks,
    fromMeasured,
    fromVelocity,
    fromHistory,
    skippedSlow,
    historyCapped,
    demandLooksCumulative: cumulative,
    trimmedToBudget,
    budgetCeiling,
    coveredByShelf,
    snapshotCount,
    newestSnapshot: snapshotDays[0]?.takenAt ?? null,
    totalCost: money(lines.reduce((s, l) => s + l.lineCost, 0)),
    versionTotals: {
      full: tally(lines, (l) => l.casesFull),
      balanced: tally(lines, (l) => l.casesBalanced),
      lean: tally(lines, (l) => l.casesLean),
    },
    notes: notes.slice(0, 20),
  };
}

/** Line count and cost of one version. */
function tally(lines: ReorderLine[], pick: (l: ReorderLine) => number): { lines: number; cost: number } {
  let count = 0;
  let cost = 0;
  for (const l of lines) {
    const n = pick(l);
    if (n > 0) { count++; cost += n * l.caseCost; }
  }
  return { lines: count, cost: money(cost) };
}

/** The median cost of recent orders from this vendor — what "normal" means. */
async function medianOrderCost(locationId: string, vendor: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ total: number }[]>`
    SELECT SUM("lineCost")::float AS total
    FROM "VendorOrderLine"
    WHERE "locationId" = ${locationId} AND vendor = ${vendor}
    GROUP BY "orderId"
  `;
  const totals = rows.map((r) => r.total).filter((n) => n > 0).sort((a, b) => a - b);
  if (totals.length === 0) return null;
  const mid = Math.floor(totals.length / 2);
  return totals.length % 2 ? totals[mid] : (totals[mid - 1] + totals[mid]) / 2;
}
