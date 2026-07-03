import { Fragment } from "react";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { fmtMoney } from "@/lib/format";
import { rangeFor, customRange, startOfMonth, toISODate } from "@/lib/period";
import { listCash, sumCash } from "@/lib/cash";
import { Card, PageHeader, EmptyState, Icon } from "@/components/ui";
import Filters from "@/components/Filters";
import AddCashForm from "./AddCashForm";
import EditCashButton from "./EditCashButton";

export const dynamic = "force-dynamic";

export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Your role can't view cash." /></Card>;
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;
  const canEdit = can(session.role, "enterSales");

  const now = new Date();
  const fromISO = sp.from || toISODate(startOfMonth(now));
  const toISO = sp.to || toISODate(now);
  const range = customRange(fromISO, toISO);
  const week = rangeFor("wtd", now);
  const month = rangeFor("mtd", now);

  const [days, weekTotal, monthTotal] = loc
    ? await Promise.all([
        listCash(loc, range.start, range.end),
        sumCash(loc, week.start, week.end),
        sumCash(loc, month.start, month.end),
      ])
    : [[], 0, 0];

  const rangeTotal = days.reduce((s, d) => s + d.effective, 0);
  const manualCount = days.filter((d) => d.manual != null).length;

  // Group by month for scannable subtotals (days already newest-first).
  const groups: { key: string; label: string; rows: typeof days; total: number }[] = [];
  for (const d of days) {
    const key = d.date.slice(0, 7);
    const label = new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, label, rows: [], total: 0 }; groups.push(g); }
    g.rows.push(d);
    g.total += d.effective;
  }

  return (
    <div>
      <PageHeader
        title="Cash"
        subtitle="Daily cash (Safe Drop) — with manual corrections when the drawer doesn't match the POS"
        actions={canEdit && <AddCashForm defaultDate={toISODate(now)} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <Kpi label="This Week" value={fmtMoney(weekTotal)} icon="calendar_view_week" tone="secondary" sub={week.label} />
        <Kpi label="This Month" value={fmtMoney(monthTotal)} icon="calendar_month" tone="secondary" sub={month.label} />
        <Kpi label="Selected Range" value={fmtMoney(rangeTotal)} icon="functions" tone="primary" featured sub={`${fromISO} → ${toISO}`} />
      </div>

      <Filters showDates />

      <Card className="overflow-hidden p-0">
        {days.length === 0 ? (
          <EmptyState icon="payments" title="No cash in this range" hint="Sync the POS or use “Add / set cash” to enter a day." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-body-sm whitespace-nowrap">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-container text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3 text-left font-semibold">Date</th>
                  <th className="px-4 py-3 text-right font-semibold">POS Safe Drop</th>
                  <th className="px-4 py-3 text-right font-semibold">Manual</th>
                  <th className="px-4 py-3 text-right font-semibold">Cash</th>
                  <th className="px-4 py-3 text-left font-semibold">Source</th>
                  {canEdit && <th className="w-10"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <tr className="bg-surface-container-low/70">
                      <td className="px-4 py-2 text-label-caps uppercase tracking-wide text-primary font-bold" colSpan={3}>{g.label}</td>
                      <td className="px-4 py-2 text-right tabular font-bold text-primary">{fmtMoney(g.total)}</td>
                      <td></td>
                      {canEdit && <td></td>}
                    </tr>
                    {g.rows.map((d) => (
                      <tr key={d.date} className="hover:bg-primary/5 transition-colors">
                        <td className="px-4 py-3 text-on-surface-variant">
                          {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </td>
                        <td className="px-4 py-3 text-right tabular">{d.pos != null ? fmtMoney(d.pos) : <span className="text-on-surface-variant/35">—</span>}</td>
                        <td className="px-4 py-3 text-right tabular">{d.manual != null ? fmtMoney(d.manual) : <span className="text-on-surface-variant/35">—</span>}</td>
                        <td className="px-4 py-3 text-right tabular font-semibold text-on-surface">{fmtMoney(d.effective)}</td>
                        <td className="px-4 py-3">
                          {d.manual != null
                            ? <span className="inline-flex items-center gap-1 text-secondary text-[11px] font-medium"><Icon name="edit_note" className="text-[14px]" /> Manual</span>
                            : <span className="inline-flex items-center gap-1 text-on-surface-variant text-[11px]"><Icon name="point_of_sale" className="text-[14px]" /> POS</span>}
                        </td>
                        {canEdit && (
                          <td className="px-2 py-3 text-right">
                            <EditCashButton date={d.date} pos={d.pos} manual={d.manual} effective={d.effective} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0">
                <tr className="bg-surface-container font-bold text-on-surface border-t-2 border-outline-variant">
                  <td className="px-4 py-3">Range Total{manualCount > 0 ? ` · ${manualCount} manual` : ""}</td>
                  <td colSpan={2}></td>
                  <td className="px-4 py-3 text-right tabular text-primary">{fmtMoney(rangeTotal)}</td>
                  <td></td>
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

function Kpi({ label, value, icon, tone, featured, sub }: { label: string; value: string; icon: string; tone: "primary" | "secondary"; featured?: boolean; sub?: string }) {
  const toneCls = tone === "primary" ? "text-primary bg-primary/10" : "text-secondary bg-secondary/10";
  return (
    <Card className={`p-4 flex items-center gap-3 ${featured ? "ring-1 ring-primary/20" : ""}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${toneCls}`}>
        <Icon name={icon} className="text-[20px]" />
      </div>
      <div className="min-w-0">
        <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
        <div className={`tabular font-bold text-on-surface mt-0.5 ${featured ? "text-xl" : "text-lg"}`}>{value}</div>
        {sub && <div className="text-[10px] text-on-surface-variant/70 truncate">{sub}</div>}
      </div>
    </Card>
  );
}
