import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { money, pctChange } from "@/lib/calc";
import { fmtNumber, fmtDate } from "@/lib/format";
import { customRange, previousRange } from "@/lib/period";
import { buildSalesView } from "@/lib/salesView";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { MetricCard, SalesSection, DeptTable, FuelTable, SalesTrend } from "@/components/SalesSections";
import RangePicker from "@/components/RangePicker";
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
  searchParams: Promise<{ date?: string; from?: string; to?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  const locWhere = loc ? { locationId: loc } : {};
  const sp = await searchParams;
  const isRange = Boolean(sp.from && sp.to);

  // Resolve the active window: a date range, a single date, or the latest day.
  let range: { start: Date; end: Date; label: string };
  let exportQs: string;
  let navDate: string;
  if (isRange) {
    range = customRange(sp.from!, sp.to!);
    exportQs = `from=${sp.from}&to=${sp.to}`;
    navDate = sp.to!;
  } else {
    const latest = await prisma.sale.findFirst({ where: locWhere, orderBy: { date: "desc" }, select: { date: true } });
    const dateISO = sp.date || (latest?.date ?? new Date()).toISOString().slice(0, 10);
    const b = dayBounds(dateISO);
    range = { start: b.start, end: b.end, label: fmtDate(b.start) };
    exportQs = `date=${dateISO}`;
    navDate = dateISO;
  }
  const label = range.label;
  const prev = previousRange(range);

  // Trend window: the range's own days (capped) for a range, else last 7 days.
  const dayMs = 86400000;
  const trendDays = isRange
    ? Math.min(31, Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / dayMs)))
    : 7;
  const trendStart = new Date(range.end.getTime() - trendDays * dayMs);
  trendStart.setHours(0, 0, 0, 0);

  const [sales, fuelSales, prevSales, prevFuel, trendRows] = await Promise.all([
    prisma.sale.findMany({
      where: { ...locWhere, date: { gte: range.start, lt: range.end } },
      select: { paymentType: true, amount: true, refund: true, category: true, note: true },
    }),
    prisma.fuelSale.findMany({ where: { ...locWhere, date: { gte: range.start, lt: range.end } }, select: { grade: true, gallons: true, total: true, pricePerGallon: true } }),
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: prev.start, lt: prev.end } }, select: { paymentType: true, amount: true, refund: true, category: true, note: true } }),
    prisma.fuelSale.findMany({ where: { ...locWhere, date: { gte: prev.start, lt: prev.end } }, select: { grade: true, gallons: true, total: true, pricePerGallon: true } }),
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: trendStart, lt: range.end } }, select: { amount: true, date: true } }),
  ]);

  const view = buildSalesView(sales, fuelSales);
  const prevView = buildSalesView(prevSales, prevFuel);

  // Per-day total-sales trend across the trend window (oldest → newest).
  const trend7: { label: string; value: number; date: string }[] = [];
  for (let i = 0; i < trendDays; i++) {
    const d = new Date(trendStart);
    d.setDate(d.getDate() + i);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const sum = trendRows.reduce((s, x) => (x.date >= d && x.date < next ? s + x.amount : s), 0);
    trend7.push({ label: String(d.getDate()), value: money(sum), date: d.toISOString().slice(0, 10) });
  }

  const empty = sales.length === 0 && fuelSales.length === 0;
  const comparisonSub = isRange ? "vs previous period" : "vs previous day";

  return (
    <div>
      <PageHeader
        title="Daily Sales"
        subtitle={`POS closing summary · ${label}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DailyActions query={exportQs} canExport={can(session.role, "exportReports")} />
            <RangePicker from={sp.from} to={sp.to} path="/daily" />
            <DayNav date={navDate} />
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
            <MetricCard label="Daily Sales" sub="Merchandise only" s={view.merch.split} icon="shopping_bag" trend={pctChange(view.merch.split.total, prevView.merch.split.total)} href="#merch" />
            <MetricCard label="Fuel Sales" sub={`${fmtNumber(view.fuel.gallons)} gal`} s={view.fuel.split} icon="local_gas_station" trend={pctChange(view.fuel.split.total, prevView.fuel.split.total)} href="#fuel" />
            <MetricCard label="Lottery / Lotto" sub="incl. payouts" s={view.lotto.split} icon="confirmation_number" trend={pctChange(view.lotto.split.total, prevView.lotto.split.total)} href="#lottery" />
            <MetricCard label="Total Sales" sub={comparisonSub} s={view.total} icon="payments" trend={pctChange(view.total.total, prevView.total.total)} highlight />
          </div>

          <Card className="p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-on-surface">{isRange ? "Daily Total Sales" : "Last 7 days — Total Sales"}</h3>
              <span className="text-body-sm text-on-surface-variant">Tap a bar to open that day · {label}</span>
            </div>
            <SalesTrend data={trend7} />
          </Card>

          <SalesSection id="merch" title="Daily Sales — Merchandise" s={view.merch.split} className="mb-6">
            <DeptTable rows={view.merch.depts} total={view.merch.split.total} refundTotal={view.merch.refund} />
          </SalesSection>

          <SalesSection id="fuel" title="Fuel Sales" s={view.fuel.split} extra={`${fmtNumber(view.fuel.gallons)} gal`} className="mb-6">
            <FuelTable byGrade={view.fuel.byGrade} gallons={view.fuel.gallons} total={view.fuel.split.total} />
          </SalesSection>

          <SalesSection id="lottery" title="Lottery / Lotto Sales & Payouts" s={view.lotto.split}>
            <DeptTable rows={view.lotto.depts} total={view.lotto.split.total} refundTotal={0} allowNegative />
          </SalesSection>
        </>
      )}
    </div>
  );
}
