import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtMoney, fmtDate } from "@/lib/format";
import { rangeFor, customRange, startOfMonth, startOfWeek, toISODate } from "@/lib/period";
import { availableSummaryYears, buildYearSummary } from "@/lib/monthlySummary";
import { Card, PageHeader, EmptyState, Icon } from "@/components/ui";
import DeleteButton from "@/components/DeleteButton";
import ProfitDrawForm from "./ProfitDrawForm";
import { deleteProfitDraw } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function ProfitOutPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Your role can't view profit." /></Card>;
  }
  const loc = await getActiveLocationId();
  if (!loc) return <Card className="p-8"><EmptyState icon="account_balance_wallet" title="No location" /></Card>;
  const sp = await searchParams;
  const canEdit = can(session.role, "viewProfit");

  const now = new Date();
  const hasRange = Boolean(sp.from || sp.to);
  const range = hasRange ? customRange(sp.from || sp.to!, sp.to || sp.from!) : null;

  // All-time net profit (sum of every year's computed P&L) and total drawn.
  const years = await availableSummaryYears(loc);
  const summaries = await Promise.all(years.map((y) => buildYearSummary(loc, y)));
  const netProfitAllTime = summaries.reduce((s, y) => s + y.kpis.profit, 0);

  const [allDraws, agg] = await Promise.all([
    prisma.profitDraw.findMany({
      where: { locationId: loc, ...(range ? { date: { gte: range.start, lt: range.end } } : {}) },
      orderBy: { date: "asc" },
    }),
    prisma.profitDraw.aggregate({ where: { locationId: loc }, _sum: { amount: true } }),
  ]);
  const takenAllTime = agg._sum.amount ?? 0;
  const remaining = netProfitAllTime - takenAllTime;
  const rangeTotal = allDraws.reduce((s, d) => s + d.amount, 0);

  // Running total (cumulative, oldest → newest) across the shown entries.
  let running = 0;
  const rows = allDraws.map((d) => { running += d.amount; return { ...d, running }; });

  // Quick-range presets.
  const wkMon = startOfWeek(now);
  const lastWkStart = new Date(wkMon); lastWkStart.setDate(wkMon.getDate() - 7);
  const lastWkEnd = new Date(wkMon); lastWkEnd.setDate(wkMon.getDate() - 1);
  const twoWkStart = new Date(wkMon); twoWkStart.setDate(wkMon.getDate() - 14);
  const presets = [
    { label: "All Time", from: "", to: "" },
    { label: "This Week", from: toISODate(wkMon), to: toISODate(now) },
    { label: "This Month", from: toISODate(startOfMonth(now)), to: toISODate(now) },
    { label: "Last Week", from: toISODate(lastWkStart), to: toISODate(lastWkEnd) },
    { label: "Last 2 Weeks", from: toISODate(twoWkStart), to: toISODate(lastWkEnd) },
  ];
  const curFrom = sp.from || "", curTo = sp.to || "";

  return (
    <div>
      <PageHeader
        title="Profit Taken Out"
        subtitle="Owner draws against net profit — a running ledger of money taken out of the business"
        actions={canEdit && <ProfitDrawForm defaultDate={toISODate(now)} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Net Profit (all-time)" value={fmtMoney(netProfitAllTime)} icon="trending_up" tone={netProfitAllTime >= 0 ? "secondary" : "error"} />
        <Kpi label="Taken Out (all-time)" value={fmtMoney(takenAllTime)} icon="account_balance_wallet" tone="primary" />
        <Kpi label="Remaining" value={fmtMoney(remaining)} icon="savings" tone={remaining >= 0 ? "secondary" : "error"} featured />
        <Kpi label={hasRange ? "Range Taken Out" : "This View"} value={fmtMoney(rangeTotal)} icon="filter_alt" tone="primary" />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {presets.map((p) => {
          const active = curFrom === p.from && curTo === p.to;
          const href = p.from || p.to ? `/profit-out?from=${p.from}&to=${p.to}` : "/profit-out";
          return (
            <a key={p.label} href={href} className={active
              ? "px-3 py-1.5 rounded-full text-body-sm font-semibold bg-primary text-on-primary"
              : "px-3 py-1.5 rounded-full text-body-sm font-medium bg-surface-container text-on-surface-variant hover:bg-surface-container-high"}>
              {p.label}
            </a>
          );
        })}
      </div>

      <form className="flex flex-wrap items-end gap-3 mb-4 bg-surface-container-low border border-outline-variant/60 rounded-lg p-3">
        <div>
          <label className="text-label-caps uppercase text-on-surface-variant block mb-1">From</label>
          <input type="date" name="from" defaultValue={curFrom} className="ft-input py-1.5 text-body-sm" />
        </div>
        <div>
          <label className="text-label-caps uppercase text-on-surface-variant block mb-1">To</label>
          <input type="date" name="to" defaultValue={curTo} className="ft-input py-1.5 text-body-sm" />
        </div>
        <button className="ft-btn-secondary h-9">Apply</button>
        {hasRange && <a href="/profit-out" className="ft-btn-ghost h-9 flex items-center px-3">Clear</a>}
      </form>

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <EmptyState icon="account_balance_wallet" title="No profit taken out yet" hint="Use “Add profit taken out” to record an owner draw." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-body-sm whitespace-nowrap">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-container text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3 text-left font-semibold">Date</th>
                  <th className="px-4 py-3 text-left font-semibold">Note</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th className="px-4 py-3 text-right font-semibold">Running Total</th>
                  {canEdit && <th className="w-20"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-primary/5 transition-colors">
                    <td className="px-4 py-3 text-on-surface-variant">{fmtDate(d.date)}</td>
                    <td className="px-4 py-3 text-on-surface">{d.note || <span className="text-on-surface-variant/40">—</span>}</td>
                    <td className="px-4 py-3 text-right tabular font-semibold text-error">-{fmtMoney(d.amount)}</td>
                    <td className="px-4 py-3 text-right tabular font-bold text-on-surface">{fmtMoney(d.running)}</td>
                    {canEdit && (
                      <td className="px-2 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <ProfitDrawForm draw={{ id: d.id, date: toISODate(d.date), amount: d.amount, note: d.note }} defaultDate={toISODate(now)} />
                          <DeleteButton id={d.id} action={deleteProfitDraw} label="Delete this profit-taken-out entry?" />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0">
                <tr className="bg-surface-container font-bold text-on-surface border-t-2 border-outline-variant">
                  <td className="px-4 py-3" colSpan={2}>{hasRange ? "Range Total" : "Total Taken Out"}</td>
                  <td className="px-4 py-3 text-right tabular text-error">-{fmtMoney(rangeTotal)}</td>
                  <td className="px-4 py-3 text-right tabular">{fmtMoney(running)}</td>
                  {canEdit && <td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, icon, tone, featured }: { label: string; value: string; icon: string; tone: "primary" | "secondary" | "error"; featured?: boolean }) {
  const toneCls = { primary: "text-primary bg-primary/10", secondary: "text-secondary bg-secondary/10", error: "text-error bg-error/10" }[tone];
  return (
    <Card className={`p-4 flex items-center gap-3 ${featured ? "ring-1 ring-primary/20" : ""}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${toneCls}`}>
        <Icon name={icon} className="text-[20px]" />
      </div>
      <div className="min-w-0">
        <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
        <div className={`tabular font-bold text-on-surface mt-0.5 ${featured ? "text-xl" : "text-lg"}`}>{value}</div>
      </div>
    </Card>
  );
}
