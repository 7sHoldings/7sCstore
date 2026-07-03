import { Fragment } from "react";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { fmtMoney } from "@/lib/format";
import { Card, PageHeader, EmptyState, Icon } from "@/components/ui";
import { availableSummaryYears, buildYearSummary, type SummaryRow } from "@/lib/monthlySummary";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  if (!loc) return <Card className="p-8"><EmptyState icon="table_chart" title="No location" /></Card>;

  const years = await availableSummaryYears(loc);
  const year = Number(sp.year) || years[years.length - 1] || new Date().getFullYear();
  const { rows, kpis } = await buildYearSummary(loc, year);

  return (
    <div>
      <PageHeader title="Monthly Summary" subtitle="Profit & loss by month — computed from your sales, expenses, cash and fuel data" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Kpi label={`Income · ${year}`} value={fmtMoney(kpis.income)} icon="trending_up" tone="primary" />
        <Kpi label={`Expenses · ${year}`} value={fmtMoney(kpis.expenses)} icon="trending_down" tone="error" />
        <Kpi label={`Net Profit · ${year}`} value={fmtMoney(kpis.profit)} icon="account_balance_wallet" tone={kpis.profit >= 0 ? "secondary" : "error"} />
      </div>

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
              {rows.map((r, i) => <Row key={r.label} r={r} last={i === rows.length - 1} />)}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-body-sm text-on-surface-variant mt-3 max-w-3xl">
        <Icon name="info" className="text-[16px] align-text-bottom mr-1" />
        Income = Inside + Fuel + Net Lottery (sales − payout) + Other Income. Expenses = Inventory Purchases + Gas Invoices + Operating Expenses.
        Net Profit = Income − Expenses. Cash, Credit/Debit and Sales Tax are shown for reference only — sales tax is a pass-through and isn&rsquo;t part of profit.
        Historical months use your imported daily figures; recent months are computed live from the POS.
      </p>
    </div>
  );
}

function Row({ r, last }: { r: SummaryRow; last: boolean }) {
  const bg =
    r.kind === "profit" ? "bg-secondary-container"
    : r.kind === "total" ? "bg-surface-container-low"
    : r.kind === "info" ? "bg-surface-container-lowest/60"
    : "bg-surface-container-lowest";
  const strong = r.kind === "total" || r.kind === "profit";
  const labelTone = r.kind === "info" ? "text-on-surface-variant" : "text-on-surface";

  const cell = (v: number) => {
    const val = Math.round(v * 100) / 100;
    if (val === 0) return <span className="text-on-surface-variant/30">—</span>;
    const neg = val < 0;
    return <span className={neg ? "text-error" : strong ? "text-on-surface font-semibold" : "text-on-surface-variant"}>{fmtMoney(val)}</span>;
  };

  return (
    <Fragment>
      {r.section && (
        <tr>
          <td colSpan={14} className="sticky left-0 bg-surface-container-low px-4 pt-4 pb-1.5 text-label-caps uppercase tracking-wide text-primary font-bold border-t border-outline-variant">
            {r.section}
          </td>
        </tr>
      )}
      <tr className={`${bg} group`}>
        <td className={`sticky left-0 z-[1] ${bg} px-4 py-2.5 text-left ${strong ? "font-bold" : "font-medium"} ${labelTone} border-b border-outline-variant/40 ${last ? "" : ""}`}>
          {r.label}
        </td>
        {r.months.map((v, i) => (
          <td key={i} className="px-3 py-2.5 text-right tabular border-b border-outline-variant/40">{cell(v)}</td>
        ))}
        <td className={`px-4 py-2.5 text-right tabular border-b border-l border-outline-variant/40 font-semibold ${r.kind === "profit" ? "bg-secondary-container" : "bg-surface-container-high/50"}`}>{cell(r.annual)}</td>
      </tr>
    </Fragment>
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
