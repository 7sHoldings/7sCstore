"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { generateDraftOrder, refreshDraftOrder } from "@/lib/vendors/draftOrder";
import { DEFAULT_COVER_WEEKS, ORDER_VERSIONS, type VersionKey } from "@/lib/vendors/reorder";
import { syncDemand } from "@/lib/integrations/sync";

async function authorize() {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." as const };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission." as const };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." as const };
  return { session, locationId };
}

export interface OrderResult {
  error?: string;
  ok?: boolean;
  lines?: number;
  notes?: string[];
}

/** Rebuild the open draft from current demand. */
export async function rebuildDraft(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ("error" in auth) return;
  const coverRaw = Number(formData.get("coverWeeks"));
  const coverWeeks = isFinite(coverRaw) && coverRaw > 0 ? Math.min(8, coverRaw) : DEFAULT_COVER_WEEKS;
  await generateDraftOrder(auth.locationId, { vendor: "GSC", coverWeeks });
  await logAudit({
    userId: auth.session.userId,
    action: "REORDER_BUILD",
    entity: "PurchaseOrder",
    after: { vendor: "GSC", coverWeeks },
  });
  revalidatePath("/orders");
}

const casesSchema = z.object({
  lineId: z.string().min(1),
  cases: z.coerce.number().min(0).max(999),
});

/** Adjust one line's case count. */
export async function setLineCases(input: unknown): Promise<OrderResult> {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };
  const parsed = casesSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid quantity." };

  try {
    const line = await prisma.purchaseOrderLine.findFirst({
      where: { id: parsed.data.lineId, purchaseOrder: { locationId: auth.locationId, status: "DRAFT" } },
      select: { id: true },
    });
    if (!line) return { error: "That line isn't on an open draft." };
    // Flagging the edit is what stops the daily refresh from overwriting it.
    await prisma.purchaseOrderLine.update({
      where: { id: line.id },
      data: { cases: parsed.data.cases, edited: true },
    });
  } catch (e) {
    console.error(e);
    return { error: "Could not save that quantity." };
  }
  revalidatePath("/orders");
  return { ok: true };
}

/** Drop a line from the draft entirely. */
export async function removeLine(input: unknown): Promise<OrderResult> {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };
  const id = z.string().min(1).safeParse((input as { lineId?: string })?.lineId);
  if (!id.success) return { error: "Invalid line." };

  try {
    await prisma.purchaseOrderLine.deleteMany({
      where: { id: id.data, purchaseOrder: { locationId: auth.locationId, status: "DRAFT" } },
    });
  } catch (e) {
    console.error(e);
    return { error: "Could not remove that line." };
  }
  revalidatePath("/orders");
  return { ok: true };
}

/** Mark the draft placed once it has been keyed into the vendor's portal. */
export async function markPlaced(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ("error" in auth) return;
  const id = String(formData.get("purchaseOrderId") ?? "");
  if (!id) return;

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, locationId: auth.locationId, status: "DRAFT" },
    include: { _count: { select: { lines: true } } },
  });
  if (!po) return;

  await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { status: "PLACED", placedAt: new Date() },
  });
  await logAudit({
    userId: auth.session.userId,
    action: "ORDER_PLACED",
    entity: "PurchaseOrder",
    entityId: po.id,
    after: { vendor: po.vendor, lines: po._count.lines },
  });
  revalidatePath("/orders");
}

/**
 * Build an order right now, for any day of the week.
 *
 * Pulls today's sales history first so the forecast reflects everything sold up
 * to this moment, then rebuilds the draft from scratch. This is the button to
 * press when ordering on a Friday instead of waiting for Monday.
 */
export async function createOrderNow(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ("error" in auth) return;

  const coverRaw = Number(formData.get("coverWeeks"));
  const coverWeeks = isFinite(coverRaw) && coverRaw > 0 ? Math.min(8, coverRaw) : DEFAULT_COVER_WEEKS;

  // Fresh sales first; a failure here still leaves the previous window usable.
  let measured = 0;
  try {
    const d = await syncDemand(auth.locationId);
    measured = d.measured;
  } catch (e) {
    console.error("sales pull failed, building from the last known window", e);
  }

  const built = await generateDraftOrder(auth.locationId, { vendor: "GSC", coverWeeks });
  await logAudit({
    userId: auth.session.userId,
    action: "ORDER_BUILT_NOW",
    entity: "PurchaseOrder",
    entityId: built.purchaseOrderId,
    after: { lines: built.lines, coverWeeks, measuredProducts: measured },
  });
  revalidatePath("/orders");
}

/**
 * Pull the sales history and refresh the open draft from it.
 *
 * Reports what happened rather than failing quietly. The POS connection uses a
 * login session that expires, and a silent failure here looks identical to a
 * successful pull that found nothing — which is the worst possible outcome for
 * someone deciding how much stock to buy.
 */
export interface PullResult {
  ok?: boolean;
  error?: string;
  message?: string;
}

export async function refreshDemand(
  _prev: PullResult | undefined,
  _formData: FormData
): Promise<PullResult> {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };

  let d: Awaited<ReturnType<typeof syncDemand>>;
  try {
    d = await syncDemand(auth.locationId);
  } catch (e) {
    console.error("sales pull failed", e);
    // Report what actually failed. Guessing a cause from keywords sent the owner
    // to re-copy a cookie that was fine, when the real answer was a blocked
    // request — the adapter now names the cause, so pass it through verbatim.
    const raw = e instanceof Error ? e.message : String(e ?? "");
    return { error: raw || "The POS connection returned nothing, with no error given." };
  }

  if (d.measured === 0) {
    return {
      error:
        "The POS connection worked but reported no sales at all for this period. " +
        "Check the store selection in Modisoft before ordering from this.",
    };
  }

  const r = await refreshDraftOrder(auth.locationId, { vendor: "GSC" });
  await logAudit({
    userId: auth.session.userId,
    action: "ORDER_REFRESHED",
    entity: "PurchaseOrder",
    entityId: r.purchaseOrderId,
    after: {
      measured: d.measured, historyDays: d.historyDays, alignedToOrders: d.alignedToOrders,
      updated: r.updated, added: r.added, removed: r.removed, kept: r.kept,
    },
  });

  const span = d.alignedToOrders
    ? `${d.from.toISOString().slice(0, 10)} to today — the stretch your orders cover`
    : `the last ${d.historyDays} days (no order is dated yet, so this is a default window)`;

  const changed =
    r.added + r.removed + r.updated > 0
      ? ` Draft updated: ${r.added} added, ${r.removed} dropped, ${r.updated} re-forecast${r.kept ? `, ${r.kept} of yours kept` : ""}.`
      : " The draft was already current.";

  return {
    ok: true,
    message: `Read ${d.measured.toLocaleString()} product-weeks of sales covering ${span}.${changed}`,
  };
}

/**
 * Set the delivery date for one uploaded vendor order.
 *
 * The order PDFs carry only a print timestamp, so a date has to come from
 * somewhere. It matters because shelf stock is deliveries minus sales, and the
 * two only subtract meaningfully when they describe the same stretch of time.
 */
export async function setOrderDate(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ("error" in auth) return;
  const orderId = String(formData.get("orderId") ?? "");
  const dateStr = String(formData.get("orderedAt") ?? "");
  if (!orderId) return;

  const orderedAt = dateStr ? new Date(dateStr + "T12:00:00") : null;
  if (dateStr && Number.isNaN(orderedAt!.getTime())) return;

  await prisma.vendorOrderLine.updateMany({
    where: { locationId: auth.locationId, vendor: "GSC", orderId },
    data: { orderedAt },
  });
  revalidatePath("/orders");
}

/**
 * Date every undated order by stepping back one week at a time from the newest.
 *
 * Ordering is weekly, so spacing them a week apart is a good first pass. Any
 * individual date can then be corrected, and only undated orders are touched so
 * corrections are never overwritten.
 */

/**
 * Date every undated order by stepping back one week at a time from the newest.
 *
 * Ordering is weekly, so spacing them a week apart is a good first pass. Any
 * individual date can then be corrected, and only undated orders are touched so
 * corrections are never overwritten.
 */
export async function spaceOrderDatesWeekly(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ("error" in auth) return;

  const newestStr = String(formData.get("newest") ?? "");
  const newest = newestStr ? new Date(newestStr + "T12:00:00") : new Date();
  if (Number.isNaN(newest.getTime())) return;

  const orders = await prisma.vendorOrderLine.groupBy({
    by: ["orderId"],
    where: { locationId: auth.locationId, vendor: "GSC" },
    _max: { orderSeq: true, orderedAt: true },
  });

  // Newest first, so index 0 gets the newest date.
  orders.sort((a, b) => (b._max.orderSeq ?? 0) - (a._max.orderSeq ?? 0));

  for (let i = 0; i < orders.length; i++) {
    if (orders[i]._max.orderedAt) continue; // never overwrite a date already set
    const d = new Date(newest);
    d.setDate(d.getDate() - i * 7);
    await prisma.vendorOrderLine.updateMany({
      where: { locationId: auth.locationId, vendor: "GSC", orderId: orders[i].orderId },
      data: { orderedAt: d },
    });
  }

  await logAudit({
    userId: auth.session.userId,
    action: "ORDER_DATES_SET",
    entity: "VendorOrderLine",
    after: { orders: orders.length, newest: newest.toISOString().slice(0, 10) },
  });
  revalidatePath("/orders");
}

/** Discard the open draft so a fresh one can be built. */

/** Discard the open draft so a fresh one can be built. */
export async function deleteDraft(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ("error" in auth) return;
  const id = String(formData.get("purchaseOrderId") ?? "");

  const where = id
    ? { id, locationId: auth.locationId, status: "DRAFT" }
    : { locationId: auth.locationId, vendor: "GSC", status: "DRAFT" };

  // Lines go with it via the cascade on PurchaseOrderLine.
  const removed = await prisma.purchaseOrder.deleteMany({ where });
  await logAudit({
    userId: auth.session.userId,
    action: "ORDER_DRAFT_DELETED",
    entity: "PurchaseOrder",
    entityId: id || null,
    after: { removed: removed.count },
  });
  revalidatePath("/orders");
}

/**
 * Switch the order between its Full, Balanced and Lean sizes.
 *
 * Only lines still on their suggestion move — a quantity set by hand is the
 * owner's decision and survives a resize, the same way it survives the daily
 * refresh.
 */

/**
 * Switch the order between its Full, Balanced and Lean sizes.
 *
 * Only lines still on their suggestion move — a quantity set by hand is the
 * owner's decision and survives a resize, the same way it survives the daily
 * refresh.
 */
export async function setOrderVersion(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ("error" in auth) return;

  const version = String(formData.get("version") ?? "full") as VersionKey;
  if (!ORDER_VERSIONS.some((v) => v.key === version)) return;

  const draft = await prisma.purchaseOrder.findFirst({
    where: { locationId: auth.locationId, vendor: "GSC", status: "DRAFT" },
    include: { lines: true },
  });
  if (!draft) return;

  const pick = (l: (typeof draft.lines)[number]): number =>
    version === "full" ? l.casesFull ?? l.suggestedCases
      : version === "balanced" ? l.casesBalanced ?? l.suggestedCases
      : l.casesLean ?? l.suggestedCases;

  await prisma.$transaction([
    prisma.purchaseOrder.update({ where: { id: draft.id }, data: { version } }),
    ...draft.lines
      .filter((l) => !l.edited)
      .map((l) =>
        prisma.purchaseOrderLine.update({
          where: { id: l.id },
          data: { cases: pick(l), suggestedCases: pick(l) },
        })
      ),
  ]);

  await logAudit({
    userId: auth.session.userId,
    action: "ORDER_VERSION_SET",
    entity: "PurchaseOrder",
    entityId: draft.id,
    after: { version },
  });
  revalidatePath("/orders");
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

export interface DemandDiagnosis {
  error?: string;
  /** Rows of sales stored, and how they break down. */
  demandRows: number;
  weeklyPeriods: number;
  longPeriods: number;
  oldest: string | null;
  newest: string | null;
  /** Distinct products with any sales figure. */
  soldProducts: number;
  /** Products this vendor supplies. */
  catalogue: number;
  /** Products present in BOTH — the ones a forecast can actually use. */
  matched: number;
  /** Vendor products with no sales row, as examples. */
  sampleUnmatchedCatalogue: { upcNorm: string; description: string }[];
  /** Sales rows with no vendor product, as examples. */
  sampleUnmatchedSales: string[];
  /** True when every week carries the same figure — a running total, not sales. */
  looksCumulative: boolean;
}

/**
 * Explain why sales are or aren't driving the order.
 *
 * The forecast joins vendor products to POS sales on a normalised scan code, and
 * when that join finds nothing the order silently falls back to past orders and
 * looks identical every week. This reports the join itself — how many matched,
 * and examples from each side that didn't — so the answer is a fact rather than
 * a guess.
 */
export async function diagnoseDemand(): Promise<DemandDiagnosis> {
  const auth = await authorize();
  const empty: DemandDiagnosis = {
    demandRows: 0, weeklyPeriods: 0, longPeriods: 0, oldest: null, newest: null,
    soldProducts: 0, catalogue: 0, matched: 0,
    sampleUnmatchedCatalogue: [], sampleUnmatchedSales: [], looksCumulative: false,
  };
  if ("error" in auth) return { ...empty, error: auth.error };
  const loc = auth.locationId;

  const [rows] = await prisma.$queryRaw<{
    demandRows: number; weeklyPeriods: number; longPeriods: number;
    oldest: Date | null; newest: Date | null; soldProducts: number;
  }[]>`
    SELECT COUNT(*)::int                                        AS "demandRows",
           COUNT(DISTINCT "periodStart") FILTER (WHERE "periodDays" = 7)::int  AS "weeklyPeriods",
           COUNT(DISTINCT "periodStart") FILTER (WHERE "periodDays" > 7)::int  AS "longPeriods",
           MIN("periodStart")                                   AS oldest,
           MAX("periodStart")                                   AS newest,
           COUNT(DISTINCT "upcNorm")::int                       AS "soldProducts"
    FROM "ProductDemand" WHERE "locationId" = ${loc}
  `;

  const [counts] = await prisma.$queryRaw<{ catalogue: number; matched: number }[]>`
    WITH cat AS (
      SELECT DISTINCT "upcNorm" FROM "VendorOrderLine"
      WHERE "locationId" = ${loc} AND vendor = 'GSC'
    ),
    sold AS (
      SELECT DISTINCT "upcNorm" FROM "ProductDemand" WHERE "locationId" = ${loc}
    )
    SELECT (SELECT COUNT(*)::int FROM cat)                                  AS catalogue,
           (SELECT COUNT(*)::int FROM cat JOIN sold USING ("upcNorm"))      AS matched
  `;

  const unmatchedCat = await prisma.$queryRaw<{ upcNorm: string; description: string }[]>`
    SELECT DISTINCT v."upcNorm", MIN(v.description) AS description
    FROM "VendorOrderLine" v
    WHERE v."locationId" = ${loc} AND v.vendor = 'GSC'
      AND NOT EXISTS (
        SELECT 1 FROM "ProductDemand" d
        WHERE d."locationId" = ${loc} AND d."upcNorm" = v."upcNorm"
      )
    GROUP BY v."upcNorm" LIMIT 6
  `;

  const unmatchedSales = await prisma.$queryRaw<{ upcNorm: string }[]>`
    SELECT DISTINCT d."upcNorm"
    FROM "ProductDemand" d
    WHERE d."locationId" = ${loc}
      AND NOT EXISTS (
        SELECT 1 FROM "VendorOrderLine" v
        WHERE v."locationId" = ${loc} AND v.vendor = 'GSC' AND v."upcNorm" = d."upcNorm"
      )
    LIMIT 6
  `;

  // Same test the engine applies before trusting the figures.
  const flat = await prisma.$queryRaw<{ flat: number; considered: number }[]>`
    WITH per AS (
      SELECT "upcNorm", COUNT(*)::int AS weeks, COUNT(DISTINCT "soldUnits")::int AS distinct_values
      FROM "ProductDemand"
      WHERE "locationId" = ${loc} AND "periodDays" = 7 AND "soldUnits" > 0
      GROUP BY "upcNorm" HAVING COUNT(*) >= 3
    )
    SELECT COUNT(*) FILTER (WHERE distinct_values = 1)::int AS flat,
           COUNT(*)::int                                    AS considered
    FROM per
  `;
  const f = flat[0] ?? { flat: 0, considered: 0 };

  return {
    demandRows: rows?.demandRows ?? 0,
    weeklyPeriods: rows?.weeklyPeriods ?? 0,
    longPeriods: rows?.longPeriods ?? 0,
    oldest: rows?.oldest ? rows.oldest.toISOString().slice(0, 10) : null,
    newest: rows?.newest ? rows.newest.toISOString().slice(0, 10) : null,
    soldProducts: rows?.soldProducts ?? 0,
    catalogue: counts?.catalogue ?? 0,
    matched: counts?.matched ?? 0,
    sampleUnmatchedCatalogue: unmatchedCat,
    sampleUnmatchedSales: unmatchedSales.map((r) => r.upcNorm),
    looksCumulative: f.considered >= 20 && f.flat / f.considered > 0.5,
  };
}
