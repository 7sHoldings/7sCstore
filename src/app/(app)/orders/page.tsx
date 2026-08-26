import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { money } from "@/lib/calc";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/format";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui";
import { isMissingTableError, SETUP_SQL_PATH } from "@/lib/setupError";
import DraftOrder from "./DraftOrder";
import Deliveries from "./Deliveries";
import { createOrderNow, refreshDemand } from "./actions";
import { HISTORY_DAYS } from "@/lib/integrations/sync";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = (await getSession())!;
  if (!can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  if (!loc) return <Card className="p-8"><EmptyState icon="store" title="No location" /></Card>;

  const canEdit = can(session.role, "enterPurchases");

  let data;
  try {
    data = await loadOrderData(loc);
  } catch (e) {
    if (!isMissingTableError(e)) throw e;
    return (
      <div>
        <PageHeader title="Weekly Order" subtitle="One setup step is outstanding" />
        <Card className="p-6 max-w-2xl">
          <h2 className="font-semibold text-on-surface mb-2">The ordering tables aren&apos;t in the database yet</h2>
          <p className="text-body-sm text-on-surface-variant mb-3">
            The app was deployed but its new tables were never created, so this page has
            nothing to read. No data is missing — the tables simply don&apos;t exist yet.
          </p>
          <p className="text-body-sm text-on-surface-variant mb-3">
            In Supabase, open the <strong>SQL editor</strong> and run the file{" "}
            <code className="bg-surface-container px-1.5 py-0.5 rounded">{SETUP_SQL_PATH}</code>{" "}
            from the repository, then reload this page. It only creates new tables and
            touches nothing that already exists.
          </p>
          <p className="text-body-sm text-on-surface-variant">
            The GSC Pricing page needs the same step.
          </p>
        </Card>
      </div>
    );
  }
  const { draft, recent, snapshotDays, catalogCount, demandProducts, demandPeriods, pastOrders } = data;
  const orderStats = pastOrders;
  const pastTotals = pastOrders.map((o) => o.total).filter((n) => n > 0).sort((a, b) => a - b);
  const typicalOrder = pastTotals.length
    ? pastTotals.length % 2
      ? pastTotals[(pastTotals.length - 1) / 2]
      : (pastTotals[pastTotals.length / 2 - 1] + pastTotals[pastTotals.length / 2]) / 2
    : null;

  const lines = draft?.lines ?? [];
  const draftCover = draft?.coverWeeks ?? 1;
  const totalCost = money(lines.reduce((s, l) => s + l.cases * l.caseCost, 0));
  const tally = (pick: (l: (typeof lines)[number]) => number | null) => {
    let n = 0, cost = 0;
    for (const l of lines) { const c = pick(l) ?? 0; if (c > 0) { n++; cost += c * l.caseCost; } }
    return { lines: n, cost: money(cost) };
  };
  const versionTotals = {
    full: tally((l) => l.casesFull),
    balanced: tally((l) => l.casesBalanced),
    lean: tally((l) => l.casesLean),
  };

  const measured = lines.filter((l) => l.basis === "measured" || l.basis === "velocity").length;
  const readings = snapshotDays.length;

  return (
    <div>
      <PageHeader
        title="Weekly Order"
        subtitle="Forecast from what actually sold — rebuilt Monday, kept current daily, or built on demand"
        actions={
          canEdit && (
            <form action={createOrderNow}>
              <input type="hidden" name="coverWeeks" value={String(draftCover)} readOnly />
              <button className="ft-btn-primary">
                <span className="material-symbols-outlined text-[18px]">bolt</span>
                Create order now
              </button>
            </form>
          )
        }
      />

      {/* What the forecast is based on */}
      <Card className={`p-4 mb-6 ${demandPeriods.length === 0 ? "border-tertiary/40" : ""}`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-sm">
          <span className="flex items-center gap-2 font-semibold text-on-surface">
            <span className="material-symbols-outlined text-[20px] text-primary">insights</span>
            Forecast based on
          </span>
          <span className="text-on-surface-variant">
            {demandPeriods.length > 0 ? (
              <>
                <Badge tone="success">sales history</Badge>{" "}
                {fmtNumber(demandProducts.length)} products across{" "}
                {fmtNumber(demandPeriods.length)} week{demandPeriods.length === 1 ? "" : "s"} — the
                order uses each product&apos;s <strong>median</strong> week, so one unusual week
                can&apos;t drive it
                {demandPeriods[0]?.measuredAt && ` · pulled ${fmtDate(demandPeriods[0].measuredAt)}`}
              </>
            ) : readings >= 2 ? (
              <>
                <Badge tone="success">inventory readings</Badge>{" "}
                {readings} readings · newest {fmtDate(snapshotDays[0].takenAt)}
              </>
            ) : (
              <>
                <Badge tone="warning">past orders only</Badge>{" "}
                no sales history pulled yet — quantities come from what you have bought before
              </>
            )}
          </span>
          <span className="text-on-surface-variant">
            {fmtNumber(catalogCount.length)} products bought from GSC
          </span>
          {canEdit && (
            <form action={refreshDemand} className="ml-auto">
              <button className="ft-btn-secondary py-1.5">Update from today&apos;s sales</button>
            </form>
          )}
        </div>
      </Card>

      {orderStats.length > 0 && (
        <Deliveries
          deliveries={orderStats.map((o) => ({
            orderId: o.orderId,
            orderedAt: o.orderedAt ? o.orderedAt.toISOString() : null,
            lines: o.lines,
            units: o.units,
            total: o.total,
          }))}
          canEdit={canEdit}
          historyDays={HISTORY_DAYS}
        />
      )}

      {!draft || lines.length === 0 ? (
        <Card className="p-2">
          <EmptyState
            icon="shopping_cart"
            title="No draft order yet"
            hint={
              catalogCount.length === 0
                ? "Upload your GSC order history first — the order is built from what you actually buy."
                : "Monday's job builds this automatically. Build one now to see it."
            }
          />
          {canEdit && catalogCount.length > 0 && (
            <form action={createOrderNow} className="flex justify-center pb-6">
              <input type="hidden" name="coverWeeks" value="1" readOnly />
              <button className="ft-btn-primary">
                <span className="material-symbols-outlined text-[18px]">bolt</span>
                Create order now
              </button>
            </form>
          )}
        </Card>
      ) : (
        <DraftOrder
          purchaseOrderId={draft.id}
          createdAt={draft.createdAt.toISOString()}
          coverWeeks={draft.coverWeeks}
          canEdit={canEdit}
          refreshedAt={draft.refreshedAt.toISOString()}
          totalCost={totalCost}
          typicalOrder={typicalOrder}
          pastOrderCount={pastTotals.length}
          version={draft.version}
          versionTotals={versionTotals}
          measured={measured}
          lines={lines.map((l) => ({
            id: l.id,
            sku: l.sku,
            upcNorm: l.upcNorm,
            description: l.description,
            department: l.department,
            unitsPerCase: l.unitsPerCase,
            caseCost: l.caseCost,
            weeklyUnits: l.weeklyUnits,
            suggestedCases: l.suggestedCases,
            cases: l.cases,
            basis: l.basis,
            soldInWindow: l.soldInWindow,
            windowDays: l.windowDays,
            edited: l.edited,
            weeklySeries: l.weeklySeries,
            weeksWithSales: l.weeksWithSales,
            typicalCases: l.typicalCases,
            cappedByHistory: l.cappedByHistory,
            receivedUnits: l.receivedUnits,
            soldInHistory: l.soldInHistory,
            onHand: l.onHand,
            casesFull: l.casesFull,
            casesBalanced: l.casesBalanced,
            casesLean: l.casesLean,
          }))}
        />
      )}

      {recent.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">
            Recently placed
          </div>
          <div className="divide-y divide-outline-variant/40">
            {recent.map((o) => (
              <div key={o.id} className="px-4 py-3 flex items-center justify-between text-body-sm">
                <span className="text-on-surface">
                  {o.vendor} · {fmtNumber(o._count.lines)} lines
                </span>
                <span className="text-on-surface-variant">
                  {o.placedAt ? fmtDate(o.placedAt) : ""}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/** Everything the page reads, in one place so a missing table is catchable. */
async function loadOrderData(loc: string) {
  const [draft, recent, snapshotDays, catalogCount] = await Promise.all([
    prisma.purchaseOrder.findFirst({
      where: { locationId: loc, vendor: "GSC", status: "DRAFT" },
      include: { lines: { orderBy: { weeklyUnits: "desc" } } },
    }),
    prisma.purchaseOrder.findMany({
      where: { locationId: loc, status: "PLACED" },
      orderBy: { placedAt: "desc" },
      take: 6,
      include: { _count: { select: { lines: true } } },
    }),
    prisma.productMovement.findMany({
      where: { locationId: loc },
      distinct: ["takenAt"],
      select: { takenAt: true },
      orderBy: { takenAt: "desc" },
      take: 2,
    }),
    prisma.vendorOrderLine.findMany({
      where: { locationId: loc, vendor: "GSC" },
      distinct: ["upcNorm"],
      select: { upcNorm: true },
    }),
  ]);

  const [demandProducts, demandPeriods, pastOrders] = await Promise.all([
    prisma.productDemand.findMany({ where: { locationId: loc }, distinct: ["upcNorm"], select: { upcNorm: true } }),
    prisma.productDemand.findMany({
      where: { locationId: loc }, distinct: ["periodStart"],
      select: { periodStart: true, measuredAt: true }, orderBy: { periodStart: "desc" },
    }),
    // What past GSC orders cost and when they landed — the yardstick for the
    // suggestion, and the record of what reached the shelves.
    prisma.$queryRaw<{ orderId: string; total: number; orderedAt: Date | null; lines: number; units: number }[]>`
      SELECT "orderId",
             SUM("lineCost")::float                                    AS total,
             MAX("orderedAt")                                          AS "orderedAt",
             COUNT(*)::int                                             AS lines,
             SUM(quantity * GREATEST("unitsPerCase", 1))::float        AS units
      FROM "VendorOrderLine"
      WHERE "locationId" = ${loc} AND vendor = 'GSC'
      GROUP BY "orderId"
      ORDER BY MAX("orderSeq") DESC
      LIMIT 60
    `,
  ]);


  return { draft, recent, snapshotDays, catalogCount, demandProducts, demandPeriods, pastOrders };
}
