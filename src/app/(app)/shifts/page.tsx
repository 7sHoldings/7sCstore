import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { dateWhere } from "@/lib/filters";
import { fmtMoney, fmtDate } from "@/lib/format";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import Filters from "@/components/Filters";
import ShiftForm from "./ShiftForm";
import DeleteButton from "@/components/DeleteButton";
import { deleteShift } from "./actions";
import { toISODate } from "@/lib/period";

export const dynamic = "force-dynamic";

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "enterSales") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const sp = await searchParams;
  const loc = await getActiveLocationId();

  const where: Record<string, unknown> = { ...dateWhere(sp) };
  if (loc) where.locationId = loc;

  const [shifts, users] = await Promise.all([
    prisma.shift.findMany({ where, include: { user: true }, orderBy: { date: "desc" }, take: 200 }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const totalVariance = shifts.reduce((s, x) => s + x.variance, 0);
  const shortages = shifts.filter((s) => s.variance < 0).length;
  const canDelete = can(session.role, "editDelete");

  return (
    <div>
      <PageHeader
        title="Shifts & Cash Reconciliation"
        subtitle="Compare expected vs counted cash for each shift"
        actions={<ShiftForm defaultDate={toISODate(new Date())} users={users.map((u) => ({ id: u.id, name: u.name }))} />}
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Tile label="Shifts" value={String(shifts.length)} />
        <Tile label="Net Variance" value={fmtMoney(totalVariance)} accent={totalVariance < 0 ? "error" : "success"} />
        <Tile label="Shortages" value={String(shortages)} accent={shortages ? "error" : undefined} />
      </div>

      <Filters />

      <Card className="overflow-hidden">
        {shifts.length === 0 ? (
          <EmptyState icon="schedule" title="No shifts recorded" hint="Record a shift to reconcile the cash drawer." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3 text-right">Open</th>
                  <th className="px-4 py-3 text-right">Drop</th>
                  <th className="px-4 py-3 text-right">Expected</th>
                  <th className="px-4 py-3 text-right">Counted</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                  {canDelete && <th></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {shifts.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 whitespace-nowrap text-on-surface-variant">{fmtDate(s.date)}</td>
                    <td className="px-4 py-3 text-on-surface">{s.user?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(s.openCash)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(s.cashDrop)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(s.expectedCash)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(s.closeCash)}</td>
                    <td className="px-4 py-3 text-right">
                      {s.variance === 0 ? (
                        <Badge tone="success">Balanced</Badge>
                      ) : s.variance < 0 ? (
                        <Badge tone="error">Short {fmtMoney(Math.abs(s.variance))}</Badge>
                      ) : (
                        <Badge tone="info">Over {fmtMoney(s.variance)}</Badge>
                      )}
                    </td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <DeleteButton id={s.id} action={deleteShift} label="Delete this shift?" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: "error" | "success" }) {
  const color = accent === "error" ? "text-error" : accent === "success" ? "text-secondary" : "text-on-surface";
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className={`tabular text-lg font-bold mt-1 ${color}`}>{value}</div>
    </Card>
  );
}
