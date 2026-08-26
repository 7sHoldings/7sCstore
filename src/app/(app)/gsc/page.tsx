import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { money } from "@/lib/calc";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { buildComparison, getDepartmentMargins, FALLBACK_MARGIN } from "@/lib/vendors/gscCompare";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import GscUpload from "./GscUpload";
import GscCompare from "./GscCompare";
import MarginSettings from "./MarginSettings";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function GscPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewAll")) {
    return (
      <Card className="p-8">
        <EmptyState icon="lock" title="No access" hint="Your role can't view vendor pricing." />
      </Card>
    );
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;
  const canEdit = can(session.role, "enterPurchases");

  if (!loc) {
    return <Card className="p-8"><EmptyState icon="store" title="No location" hint="Assign a location first." /></Card>;
  }

  const view = sp.view ?? "raise";
  const page = Math.max(1, Number(sp.page) || 1);

  const [rows, margins, orderStats, departments] = await Promise.all([
    buildComparison(loc, {
      needsRaiseOnly: view === "raise",
      unmatchedOnly: view === "unmatched",
      department: sp.dept || undefined,
      q: sp.q || undefined,
    }),
    getDepartmentMargins(loc),
    prisma.vendorOrderLine.groupBy({
      by: ["orderId"],
      where: { locationId: loc, vendor: "GSC" },
      _count: { _all: true },
      orderBy: { orderId: "desc" },
      take: 200,
    }),
    prisma.product.groupBy({
      by: ["department"],
      where: { locationId: loc },
      _count: { _all: true },
      orderBy: { department: "asc" },
    }),
  ]);

  // Totals across everything matched, independent of the current view.
  const all = await buildComparison(loc, {});
  const belowFloor = all.filter((r) => r.needsRaise);
  const opportunity = money(belowFloor.reduce((s, r) => s + r.increase, 0));
  const unmatched = all.filter((r) => r.unmatched).length;

  const deptNames = departments.map((d) => d.department).filter((d): d is string => !!d);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="GSC Pricing"
        subtitle="Compare your shelf prices against the latest GSC order cost"
        actions={canEdit && <GscUpload />}
      />

      {orderStats.length === 0 ? (
        <Card className="p-2">
          <EmptyState
            icon="picture_as_pdf"
            title="No GSC orders uploaded yet"
            hint="Upload your GSC printable order PDFs to pull in vendor cost, pack size and suggested retail."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Tile label="Orders Uploaded" value={fmtNumber(orderStats.length)} hint={`latest #${orderStats[0]?.orderId ?? "—"}`} />
            <Tile label="Products Costed" value={fmtNumber(all.length - unmatched)} hint={`${fmtNumber(all.length)} GSC items`} />
            <Tile label="Below Margin Floor" value={fmtNumber(belowFloor.length)} accent={belowFloor.length ? "warning" : undefined} />
            <Tile label="Missed Margin" value={fmtMoney(opportunity)} hint="per unit, if all raised" accent={opportunity > 0 ? "warning" : undefined} />
          </div>

          <MarginSettings
            departments={deptNames}
            margins={Object.fromEntries(margins)}
            fallback={FALLBACK_MARGIN}
            canEdit={canEdit}
          />

          <GscCompare
            rows={pageRows}
            total={rows.length}
            page={page}
            pageCount={pageCount}
            pageSize={PAGE_SIZE}
            view={view}
            dept={sp.dept ?? ""}
            q={sp.q ?? ""}
            departments={deptNames}
            canEdit={canEdit}
            counts={{ raise: belowFloor.length, all: all.length, unmatched }}
          />
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: "warning" }) {
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
      <div className={`tabular text-lg font-bold mt-1 ${accent === "warning" ? "text-tertiary" : "text-on-surface"}`}>{value}</div>
      {hint && <div className="text-body-sm text-on-surface-variant mt-0.5 truncate">{hint}</div>}
    </Card>
  );
}
