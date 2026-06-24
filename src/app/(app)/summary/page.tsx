import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function MonthlySummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;

  // Which years have data?
  const years = loc
    ? (await prisma.monthlySummary.findMany({ where: { locationId: loc }, distinct: ["year"], select: { year: true }, orderBy: { year: "asc" } })).map((y) => y.year)
    : [];
  const year = Number(sp.year) || years[years.length - 1] || new Date().getFullYear();

  const rows = loc
    ? await prisma.monthlySummary.findMany({ where: { locationId: loc, year }, orderBy: { sortOrder: "asc" } })
    : [];

  const cell = (v: number) =>
    v === 0 ? <span className="text-on-surface-variant/40">—</span> : <span className={v < 0 ? "text-error" : ""}>{fmtMoney(v)}</span>;

  return (
    <div>
      <PageHeader title="Monthly Summary" subtitle="Imported P&L summary by month" />

      {years.length > 1 && (
        <div className="flex gap-2 mb-4">
          {years.map((y) => (
            <a key={y} href={`/summary?year=${y}`} className={y === year ? "ft-btn-primary" : "ft-btn-secondary"}>{y}</a>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon="table_chart" title="No summary imported" hint="Import the monthly summary from Excel via Import Data." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm whitespace-nowrap">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-3 py-3 sticky left-0 bg-surface-container-low">Category</th>
                  {MONTHS.map((m) => <th key={m} className="px-3 py-3 text-right">{m}</th>)}
                  <th className="px-3 py-3 text-right font-bold">Annual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {rows.map((r) => {
                  const months = (r.months as number[]) ?? [];
                  return (
                    <tr key={r.id} className="hover:bg-surface-container-low/50">
                      <td className="px-3 py-2.5 text-on-surface font-medium sticky left-0 bg-surface-container-lowest">{r.category}</td>
                      {MONTHS.map((_, i) => (
                        <td key={i} className="px-3 py-2.5 text-right tabular">{cell(Math.round((months[i] ?? 0) * 100) / 100)}</td>
                      ))}
                      <td className="px-3 py-2.5 text-right tabular font-semibold">{cell(Math.round(r.annual * 100) / 100)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
