import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { money } from "@/lib/calc";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/format";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui";
import DraftOrder from "./DraftOrder";
import { rebuildDraft } from "./actions";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = (await getSession())!;
  if (!can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  if (!loc) return <Card className="p-8"><EmptyState icon="store" title="No location" /></Card>;

  const canEdit = can(session.role, "enterPurchases");

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

  const lines = draft?.lines ?? [];
  const totalCost = money(lines.reduce((s, l) => s + l.cases * l.caseCost, 0));
  const measured = lines.filter((l) => l.basis === "velocity").length;
  const readings = snapshotDays.length;

  return (
    <div>
      <PageHeader
        title="Weekly Order"
        subtitle="Built from measured sales every Monday morning — review, adjust, then order"
      />

      {/* How demand is being measured right now */}
      <Card className={`p-4 mb-6 ${readings < 2 ? "border-tertiary/40" : ""}`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-sm">
          <span className="flex items-center gap-2 font-semibold text-on-surface">
            <span className="material-symbols-outlined text-[20px] text-primary">insights</span>
            Demand signal
          </span>
          <span className="text-on-surface-variant">
            {readings >= 2 ? (
              <>
                <Badge tone="success">measuring</Badge>{" "}
                {readings} inventory readings · newest {fmtDate(snapshotDays[0].takenAt)}
              </>
            ) : readings === 1 ? (
              <>
                <Badge tone="warning">baseline only</Badge>{" "}
                one reading taken {fmtDate(snapshotDays[0].takenAt)} — quantities come from past
                orders until a second reading lands
              </>
            ) : (
              <>
                <Badge tone="warning">no readings yet</Badge>{" "}
                pull inventory once and the nightly job takes it from there
              </>
            )}
          </span>
          <span className="text-on-surface-variant">
            {fmtNumber(catalogCount.length)} products bought from GSC
          </span>
        </div>
      </Card>

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
            <form action={rebuildDraft} className="flex justify-center pb-6">
              <input type="hidden" name="coverWeeks" value="1" />
              <button className="ft-btn-primary">Build order now</button>
            </form>
          )}
        </Card>
      ) : (
        <DraftOrder
          purchaseOrderId={draft.id}
          createdAt={draft.createdAt.toISOString()}
          coverWeeks={draft.coverWeeks}
          canEdit={canEdit}
          totalCost={totalCost}
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
