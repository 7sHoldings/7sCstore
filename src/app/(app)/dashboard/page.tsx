import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { rangeFor, type PeriodKey } from "@/lib/period";
import { getDashboard, getPeriodTotals } from "@/lib/reports";
import { fmtMoney, fmtGallons, fmtMoney4, gradeLabel } from "@/lib/format";
import { Card, KpiCard, PageHeader, Icon, Badge } from "@/components/ui";
import { TrendChart, DonutChart } from "@/components/charts";
import PeriodSelect from "@/components/PeriodSelect";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const period = (sp.period as PeriodKey) || "mtd";
  const range = rangeFor(period);

  const [data, totals] = await Promise.all([
    getDashboard(range, session.locationId ?? undefined),
    getPeriodTotals(session.locationId ?? undefined),
  ]);

  const showProfit = can(session.role, "viewProfit");

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Performance overview · ${range.label}`}
        actions={<PeriodSelect value={period} />}
      />

      {/* Multi-period headline strip (FR-1) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <HeadlineTile label="Today" totals={totals.today} showProfit={showProfit} />
        <HeadlineTile label="Week to date" totals={totals.wtd} showProfit={showProfit} />
        <HeadlineTile label="Month to date" totals={totals.mtd} showProfit={showProfit} />
        <HeadlineTile label="Year to date" totals={totals.ytd} showProfit={showProfit} />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Gross Sales"
          value={fmtMoney(data.pnl.grossSales)}
          trend={data.comparison.grossSales}
          hint="vs previous period"
          icon="point_of_sale"
        />
        <KpiCard
          label="Net Sales"
          value={fmtMoney(data.pnl.netSales)}
          trend={data.comparison.netSales}
          hint="after refunds"
          icon="sell"
        />
        {showProfit ? (
          <KpiCard
            label="Net Profit"
            value={fmtMoney(data.pnl.netProfit)}
            trend={data.comparison.netProfit}
            hint={`${data.pnl.profitMargin}% margin`}
            icon="savings"
            accent={data.pnl.netProfit >= 0 ? "success" : "error"}
          />
        ) : (
          <KpiCard
            label="Expenses"
            value={fmtMoney(data.pnl.operatingExpenses)}
            hint="operating expenses"
            icon="receipt_long"
            accent="error"
          />
        )}
        <KpiCard
          label="Fuel Volume"
          value={fmtGallons(data.fuel.gallons)}
          hint={fmtMoney(data.fuel.total) + " in fuel"}
          icon="local_gas_station"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-on-surface">Daily Sales Trend</h3>
              <p className="text-body-sm text-on-surface-variant">Fuel vs store performance</p>
            </div>
          </div>
          <TrendChart data={data.trend} />
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-on-surface mb-4">Revenue Mix</h3>
          <DonutChart fuel={data.fuel.total} store={data.store.total} />
          <div className="mt-5 space-y-2">
            <MixRow color="bg-primary" label="Fuel Sales" value={fmtMoney(data.fuel.total)} />
            <MixRow color="bg-secondary-container" label="Store Sales" value={fmtMoney(data.store.total)} />
          </div>
        </Card>
      </div>

      {/* Cash/Card split + fuel by grade */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <h3 className="font-semibold text-on-surface mb-4">Cash vs Card</h3>
          <PaySplit label="Cash" value={data.payment.cash} total={data.payment.cash + data.payment.card + data.payment.other} icon="payments" />
          <PaySplit label="Card" value={data.payment.card} total={data.payment.cash + data.payment.card + data.payment.other} icon="credit_card" />
          {data.payment.other > 0 && (
            <PaySplit label="Other" value={data.payment.other} total={data.payment.cash + data.payment.card + data.payment.other} icon="account_balance_wallet" />
          )}
        </Card>

        <Card className="lg:col-span-2 p-0 overflow-hidden">
          <div className="p-5 border-b border-outline-variant/60 flex items-center justify-between">
            <h3 className="font-semibold text-on-surface">Fuel by Grade</h3>
            <Link href="/reports" className="text-body-sm text-primary font-semibold hover:underline">
              View reports
            </Link>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-5 py-2.5">Grade</th>
                  <th className="px-5 py-2.5 text-right">Gallons</th>
                  <th className="px-5 py-2.5 text-right">Sales</th>
                  <th className="px-5 py-2.5 text-right">Margin/gal</th>
                  {showProfit && <th className="px-5 py-2.5 text-right">Profit</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {data.fuel.byGrade.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-on-surface-variant">
                      No fuel sales in this period.
                    </td>
                  </tr>
                )}
                {data.fuel.byGrade.map((g) => (
                  <tr key={g.grade} className="hover:bg-surface-container-low/50">
                    <td className="px-5 py-3 font-medium text-on-surface">{gradeLabel(g.grade)}</td>
                    <td className="px-5 py-3 text-right tabular">{g.gallons.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right tabular">{fmtMoney(g.total)}</td>
                    <td className="px-5 py-3 text-right tabular">{fmtMoney4(g.margin)}</td>
                    {showProfit && (
                      <td className="px-5 py-3 text-right tabular font-semibold text-secondary">
                        {fmtMoney(g.profit)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {showProfit && (
        <Card className="p-5">
          <h3 className="font-semibold text-on-surface mb-4">Profit Summary · {range.label}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <PnLStat label="Net Sales" value={fmtMoney(data.pnl.netSales)} />
            <PnLStat label="COGS" value={fmtMoney(data.pnl.cogs)} />
            <PnLStat label="Gross Profit" value={fmtMoney(data.pnl.grossProfit)} tone="success" />
            <PnLStat label="Expenses" value={fmtMoney(data.pnl.operatingExpenses)} tone="error" />
            <PnLStat label="Net Profit" value={fmtMoney(data.pnl.netProfit)} tone={data.pnl.netProfit >= 0 ? "success" : "error"} />
            <PnLStat label="Sales Tax (liability)" value={fmtMoney(data.pnl.salesTaxCollected)} />
          </div>
        </Card>
      )}
    </div>
  );
}

function HeadlineTile({
  label,
  totals,
  showProfit,
}: {
  label: string;
  totals: { netSales: number; netProfit: number };
  showProfit: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className="tabular text-xl font-bold text-primary mt-1">{fmtMoney(totals.netSales)}</div>
      {showProfit && (
        <div className="text-body-sm text-on-surface-variant mt-0.5">
          Net profit <span className={`tabular font-semibold ${totals.netProfit >= 0 ? "text-secondary" : "text-error"}`}>{fmtMoney(totals.netProfit)}</span>
        </div>
      )}
    </Card>
  );
}

function MixRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-surface-container-low rounded-md px-3 py-2">
      <span className="flex items-center gap-2 text-body-sm text-on-surface">
        <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
        {label}
      </span>
      <span className="tabular font-semibold text-on-surface text-body-sm">{value}</span>
    </div>
  );
}

function PaySplit({ label, value, total, icon }: { label: string; value: number; total: number; icon: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="flex items-center gap-2 text-body-sm text-on-surface">
          <Icon name={icon} className="text-[18px] text-primary" />
          {label}
        </span>
        <span className="tabular text-body-sm font-semibold">{fmtMoney(value)} · {pct}%</span>
      </div>
      <div className="h-2 bg-surface-container rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PnLStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "success" | "error" }) {
  const color = tone === "success" ? "text-secondary" : tone === "error" ? "text-error" : "text-on-surface";
  return (
    <div className="bg-surface-container-low rounded-md p-3">
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className={`tabular text-lg font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
