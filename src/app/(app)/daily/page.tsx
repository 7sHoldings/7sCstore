import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { money, pctChange } from "@/lib/calc";
import { fmtNumber, fmtDate } from "@/lib/format";
import { buildSalesView } from "@/lib/salesView";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { MetricCard, SalesSection, DeptTable, FuelTable } from "@/components/SalesSections";
import DayNav from "./DayNav";
import DailyActions from "./DailyActions";

export const dynamic = "force-dynamic";

function dayBounds(dateISO: string) {
  const start = new Date(dateISO + "T00:00:00");
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export default async function DailySalesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  const locWhere = loc ? { locationId: loc } : {};
  const sp = await searchParams;

  const latest = await prisma.sale.findFirst({ where: locWhere, orderBy: { date: "desc" }, select: { date: true } });
  const dateISO = sp.date || (latest?.date ?? new Date()).toISOString().slice(0, 10);
  const { start, end } = dayBounds(dateISO);
  const prev = dayBounds(new Date(start.getTime() - 86400000).toISOString().slice(0, 10));

  const trendStart = new Date(start);
  trendStart.setDate(trendStart.getDate() - 6); // 7-day window ending on `start`

  const [sales, fuelSales, prevSales, prevFuel, last7] = await Promise.all([
    prisma.sale.findMany({
      where: { ...locWhere, date: { gte: start, lt: end } },
      select: { paymentType: true, amount: true, refund: true, category: true, note: true },
    }),
    prisma.fuelSale.findMany({ where: { ...locWhere, date: { gte: start, lt: end } }, select: { grade: true, gallons: true, total: true, pricePerGallon: true } }),
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: prev.start, lt: prev.end } }, select: { paymentType: true, amount: true, refund: true, category: true, note: true } }),
    prisma.fuelSale.findMany({ where: { ...locWhere, date: { gte: prev.start, lt: prev.end } }, select: { grade: true, gallons: true, total: true, pricePerGallon: true } }),
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: trendStart, lt: end } }, select: { amount: true, date: true } }),
  ]);

  const view = buildSalesView(sales, fuelSales);
  const prevView = buildSalesView(prevSales, prevFuel);

  // 7-day total-sales trend (oldest → current day).
  const trend7: { label: string; value: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(trendStart);
    d.setDate(d.getDate() + i);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const sum = last7.reduce((s, x) => (x.date >= d && x.date < next ? s + x.amount : s), 0);
    trend7.push({ label: String(d.getDate()), value: money(sum) });
  }

  const empty = sales.length === 0 && fuelSales.length === 0;

  return (
    <div>
      <PageHeader
        title="Daily Sales"
        subtitle={`POS closing summary · ${fmtDate(start)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DailyActions date={dateISO} canExport={can(session.role, "exportReports")} />
            <DayNav date={dateISO} />
          </div>
        }
      />

      {empty ? (
        <Card className="p-8">
          <EmptyState icon="event_busy" title="No sales for this day" hint="Pick another date, or run a sync/backfill on Integrations." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <MetricCard label="Daily Sales" sub="Merchandise only" s={view.merch.split} icon="shopping_bag" trend={pctChange(view.merch.split.total, prevView.merch.split.total)} />
            <MetricCard label="Lottery / Lotto" sub="incl. payouts" s={view.lotto.split} icon="confirmation_number" trend={pctChange(view.lotto.split.total, prevView.lotto.split.total)} />
            <MetricCard label="Fuel Sales" sub={`${fmtNumber(view.fuel.gallons)} gal`} s={view.fuel.split} icon="local_gas_station" trend={pctChange(view.fuel.split.total, prevView.fuel.split.total)} />
            <MetricCard label="Total Sales" sub="vs previous day" s={view.total} icon="payments" trend={pctChange(view.total.total, prevView.total.total)} highlight />
          </div>

          <Card className="p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-on-surface">Last 7 days — Total Sales</h3>
              <span className="text-body-sm text-on-surface-variant">through {fmtDate(start)}</span>
            </div>
            <Trend7 data={trend7} />
          </Card>

          <SalesSection title="Fuel Sales" s={view.fuel.split} extra={`${fmtNumber(view.fuel.gallons)} gal`} className="mb-6">
            <FuelTable byGrade={view.fuel.byGrade} gallons={view.fuel.gallons} total={view.fuel.split.total} />
          </SalesSection>

          <SalesSection title="Lottery / Lotto Sales & Payouts" s={view.lotto.split} className="mb-6">
            <DeptTable rows={view.lotto.depts} total={view.lotto.split.total} refundTotal={0} allowNegative />
          </SalesSection>

          <SalesSection title="Daily Sales — Merchandise" s={view.merch.split}>
            <DeptTable rows={view.merch.depts} total={view.merch.split.total} refundTotal={view.merch.refund} />
          </SalesSection>
        </>
      )}
    </div>
  );
}

function Trend7({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div className="flex items-end justify-between gap-2 h-32">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end h-full group relative">
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full opacity-0 group-hover:opacity-100 transition-opacity bg-inverse-surface text-inverse-on-surface text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10 pointer-events-none">
              {fmtMoneyShort(d.value)}
            </div>
            <div
              className={`w-full rounded-t-sm ${i === data.length - 1 ? "bg-primary" : "bg-primary/40"}`}
              style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between gap-2 mt-2">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center text-[11px] text-on-surface-variant">{d.label}</div>
        ))}
      </div>
    </div>
  );
}

function fmtMoneyShort(v: number): string {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}
