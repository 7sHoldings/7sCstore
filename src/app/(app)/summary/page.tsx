import { Fragment } from "react";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { Card, PageHeader, EmptyState, Icon } from "@/components/ui";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Section a category falls under, and whether it's a highlighted subtotal/profit row.
const SECTION_START: Record<string, string> = {
  "Total Inside Sales": "Income & Sales",
  "Total Item Purchase": "Expenses",
  "Total other exp": "Summary & Profit",
};
const TOTAL_ROWS = new Set(["Total other exp", "Total Amount", "Total Exp"]);
const PROFIT_ROWS = new Set(["Gross Net", "Gross Net - Sales Tax(profit)", "Remaining Balance"]);

type Row = { id: string; category: string; months: number[]; annual: number };

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

  const years = loc
    ? (await prisma.monthlySummary.findMany({ where: { locationId: loc }, distinct: ["year"], select: { year: true }, orderBy: { year: "asc" } })).map((y) => y.year)
    : [];
  const year = Number(sp.year) || years[years.length - 1] || new Date().getFullYear();

  const raw = loc
    ? await prisma.monthlySummary.findMany({ where: { locationId: loc, year }, orderBy: { sortOrder: "asc" } })
    : [];
  const rows: Row[] = raw.map((r) => ({ id: r.id, category: r.category.trim(), months: (r.months as number[]) ?? [], annual: r.annual }));
  const byCat = (name: string) => rows.find((r) => r.category === name)?.annual ?? 0;

  // Headline KPIs (annual)
  const revenue = byCat("Total Amount");
  const expenses = byCat("Total Exp");
  const profit = byCat("Gross Net - Sales Tax(profit)");

  const fmt = (v: number, opts?: { strong?: boolean }) => {
    const r = Math.round(v * 100) / 100;
    if (r === 0) return <span className="text-on-surface-variant/35">—</span>;
    const neg = r < 0;
    return <span className={`${neg ? "text-error" : opts?.strong ? "text-on-surface" : "text-on-surface-variant"} ${opts?.strong ? "font-semibold" : ""}`}>{fmtMoney(r)}</span>;
  };

  return (
    <div>
      <PageHeader title="Monthly Summary" subtitle="Profit & loss by month" />

      {rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Kpi label={`Revenue · ${year}`} value={fmtMoney(revenue)} icon="trending_up" tone="primary" />
          <Kpi label={`Expenses · ${year}`} value={fmtMoney(expenses)} icon="trending_down" tone="error" />
          <Kpi label={`Net Profit · ${year}`} value={fmtMoney(profit)} icon="account_balance_wallet" tone={profit >= 0 ? "secondary" : "error"} />
        </div>
      )}

      {years.length > 1 && (
        <div className="inline-flex p-1 mb-4 rounded-lg bg-surface-container-low border border-outline-variant/60">
          {years.map((y) => (
            <a
              key={y}
              href={`/summary?year=${y}`}
              className={`px-4 py-1.5 rounded-md text-body-sm font-semibold transition-colors cursor-pointer ${
                y === year ? "bg-primary text-on-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {y}
            </a>
          ))}
        </div>
      )}

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <EmptyState icon="table_chart" title="No summary imported" hint="Import the monthly summary from Excel via Import Data." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar max-h-[75vh]">
            <table className="w-full border-separate border-spacing-0 text-body-sm whitespace-nowrap">
              <thead className="sticky top-0 z-20">
                <tr className="bg-surface-container text-label-caps uppercase text-on-surface-variant">
                  <th className="sticky left-0 z-10 bg-surface-container px-4 py-3 text-left font-semibold border-b border-outline-variant">Category</th>
                  {MONTHS.map((m) => <th key={m} className="px-3 py-3 text-right font-semibold border-b border-outline-variant">{m}</th>)}
                  <th className="px-4 py-3 text-right font-bold text-on-surface border-b border-l border-outline-variant bg-surface-container-high">Annual</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const section = SECTION_START[r.category];
                  const isTotal = TOTAL_ROWS.has(r.category);
                  const isProfit = PROFIT_ROWS.has(r.category);
                  // Opaque tokens (sticky first column must mask scrolled content).
                  const bg = isProfit ? "bg-secondary-container" : isTotal ? "bg-surface-container-low" : "bg-surface-container-lowest";
                  const strong = isTotal || isProfit;
                  return (
                    <Fragment key={r.id}>
                      {section && (
                        <tr>
                          <td colSpan={14} className="sticky left-0 bg-surface-container-low px-4 pt-4 pb-1.5 text-label-caps uppercase tracking-wide text-primary font-bold border-t border-outline-variant">
                            {section}
                          </td>
                        </tr>
                      )}
                      <tr className={`${bg} group`}>
                        <td className={`sticky left-0 z-[1] ${bg} px-4 py-2.5 text-left font-bold text-on-surface border-b border-outline-variant/40 group-hover:text-primary transition-colors`}>
                          {r.category}
                        </td>
                        {r.months.map((v, i) => (
                          <td key={i} className="px-3 py-2.5 text-right tabular border-b border-outline-variant/40">{fmt(v, { strong })}</td>
                        ))}
                        <td className={`px-4 py-2.5 text-right tabular border-b border-l border-outline-variant/40 font-semibold ${isProfit ? "bg-secondary-container" : "bg-surface-container-high/50"}`}>{fmt(r.annual, { strong: true })}</td>
                      </tr>
                    </Fragment>
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

function Kpi({ label, value, icon, tone }: { label: string; value: string; icon: string; tone: "primary" | "secondary" | "error" }) {
  const toneCls = { primary: "text-primary bg-primary/10", secondary: "text-secondary bg-secondary/10", error: "text-error bg-error/10" }[tone];
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${toneCls}`}>
        <Icon name={icon} className="text-[22px]" />
      </div>
      <div className="min-w-0">
        <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
        <div className="tabular text-xl font-bold text-on-surface mt-0.5">{value}</div>
      </div>
    </Card>
  );
}
