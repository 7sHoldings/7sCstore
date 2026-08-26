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

/** Ignore readings older than this when measuring velocity. */
const VELOCITY_WINDOW_DAYS = 35;
/** A pair of readings closer together than this is too noisy to extrapolate. */
const MIN_SPAN_DAYS = 2;

export interface ReorderOptions {
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
  basis: "measured" | "velocity" | "order-history";
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
  /** Products skipped because the shelf already covers the period. */
  coveredByShelf: number;
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

  const since = new Date();
  since.setDate(since.getDate() - VELOCITY_WINDOW_DAYS);

  const [catalog, demandData, shelf, velocity, snapshotDays] = await Promise.all([
    loadCatalog(locationId, vendor),
    loadDemand(locationId, demandWeeks),
    loadShelf(locationId, vendor),
    loadVelocity(locationId, since),
    prisma.productMovement.findMany({
      where: { locationId },
      distinct: ["takenAt"],
      select: { takenAt: true },
      orderBy: { takenAt: "desc" },
      take: 60,
    }),
  ]);

  const demand = demandData.series;
  const demandPeriods = demandData.periods.length;

  const notes: string[] = [];
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

    let suggestedCases = Math.ceil(unitsNeeded / perCase);
    if (suggestedCases <= 0) continue;

    // Bound the suggestion by how this product has actually been bought.
    // Past orders are the strongest evidence of what a sensible quantity looks
    // like; a forecast leaping far beyond every previous order is far more
    // often an artefact than real growth, and being wrong means stock that
    // sits. Growth is still allowed, just not in one jump.
    let cappedByHistory = false;
    const typical = c.avgCasesPerOrder;
    if (typical > 0) {
      const ceiling = Math.max(1, Math.ceil(typical * spikeGuard));
      if (suggestedCases > ceiling) {
        suggestedCases = ceiling;
        cappedByHistory = true;
        historyCapped++;
      }
    }

    if (suggestedCases > maxCasesPerLine) {
      suggestedCases = maxCasesPerLine;
      notes.push(`${c.description || c.sku} capped at ${maxCasesPerLine} cases.`);
    }

    if (basis === "measured") fromMeasured++;
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
      lastOrderedCases: c.avgCasesPerOrder > 0 ? Math.round(c.avgCasesPerOrder * 10) / 10 : null,
    });
  }

  // Busiest first — that's the order the owner wants to eyeball.
  lines.sort((a, b) => b.weeklyUnits - a.weeklyUnits);

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
    coveredByShelf,
    snapshotCount,
    newestSnapshot: snapshotDays[0]?.takenAt ?? null,
    totalCost: money(lines.reduce((s, l) => s + l.lineCost, 0)),
    notes: notes.slice(0, 20),
  };
}
