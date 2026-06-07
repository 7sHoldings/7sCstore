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

  const [sales, fuelSales, prevSales] = await Promise.all([
    prisma.sale.findMany({
      where: { ...locWhere, date: { gte: start, lt: end } },
      select: { paymentType: true, amount: true, refund: true, category: true, note: true },
    }),
    prisma.fuelSale.findMany({ where: { ...locWhere, date: { gte: start, lt: end } }, select: { grade: true, gallons: true, total: true, pricePerGallon: true } }),
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: prev.start, lt: prev.end } }, select: { amount: true } }),
  ]);

  const view = buildSalesView(sales, fuelSales);
  const prevTotal = money(prevSales.reduce((s, x) => s + x.amount, 0));
  const empty = sales.length === 0 && fuelSales.length === 0;

  return (
    <div>
      <PageHeader title="Daily Sales" subtitle={`POS closing summary · ${fmtDate(start)}`} actions={<DayNav date={dateISO} />} />

      {empty ? (
        <Card className="p-8">
          <EmptyState icon="event_busy" title="No sales for this day" hint="Pick another date, or run a sync/backfill on Integrations." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <MetricCard label="Daily Sales" sub="Merchandise only" s={view.merch.split} icon="shopping_bag" />
            <MetricCard label="Lottery / Lotto" sub="incl. payouts" s={view.lotto.split} icon="confirmation_number" />
            <MetricCard label="Fuel Sales" sub={`${fmtNumber(view.fuel.gallons)} gal`} s={view.fuel.split} icon="local_gas_station" />
            <MetricCard label="Total Sales" sub="all sources" s={view.total} icon="payments" trend={pctChange(view.total.total, prevTotal)} highlight />
          </div>

          <SalesSection title="Daily Sales — Merchandise" s={view.merch.split} className="mb-6">
            <DeptTable rows={view.merch.depts} total={view.merch.split.total} refundTotal={view.merch.refund} />
          </SalesSection>

          <SalesSection title="Lottery / Lotto Sales & Payouts" s={view.lotto.split} className="mb-6">
            <DeptTable rows={view.lotto.depts} total={view.lotto.split.total} refundTotal={0} allowNegative />
          </SalesSection>

          <SalesSection title="Fuel Sales" s={view.fuel.split} extra={`${fmtNumber(view.fuel.gallons)} gal`}>
            <FuelTable byGrade={view.fuel.byGrade} gallons={view.fuel.gallons} total={view.fuel.split.total} />
          </SalesSection>
        </>
      )}
    </div>
  );
}
