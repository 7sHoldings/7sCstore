import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { prisma } from "@/lib/db";
import { money, pctChange } from "@/lib/calc";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { rangeFor, customRange, previousRange, type PeriodKey } from "@/lib/period";
import { buildSalesView } from "@/lib/salesView";
import { getCustomersRange } from "@/lib/integrations/sync";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { MetricCard, CountCard, SalesSection, DeptTable, FuelTable } from "@/components/SalesSections";
import PeriodSelect from "@/components/PeriodSelect";
import RangePicker from "@/components/RangePicker";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const period = (sp.period as PeriodKey) || "mtd";
  const range = sp.from && sp.to ? customRange(sp.from, sp.to) : rangeFor(period);
  const prev = previousRange(range);
  const loc = await getActiveLocationId();
  const locWhere = loc ? { locationId: loc } : {};

  const [sales, fuelSales, prevSales, customers] = await Promise.all([
    prisma.sale.findMany({
      where: { ...locWhere, date: { gte: range.start, lt: range.end } },
      select: { paymentType: true, amount: true, refund: true, category: true, note: true },
    }),
    prisma.fuelSale.findMany({
      where: { ...locWhere, date: { gte: range.start, lt: range.end } },
      select: { grade: true, gallons: true, total: true, pricePerGallon: true },
    }),
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: prev.start, lt: prev.end } }, select: { amount: true } }),
    loc ? getCustomersRange(loc, range.start, range.end) : Promise.resolve(0),
  ]);

  const view = buildSalesView(sales, fuelSales);
  const prevTotal = money(prevSales.reduce((s, x) => s + x.amount, 0));
  const avgBasket = customers > 0 ? money(view.total.total / customers) : 0;
  const empty = sales.length === 0 && fuelSales.length === 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Sales overview · ${range.label}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSelect value={period} />
            <RangePicker from={sp.from} to={sp.to} />
          </div>
        }
      />

      {empty ? (
        <Card className="p-8">
          <EmptyState icon="query_stats" title="No sales in this period" hint="Pick another period or a custom range, or run a sync/backfill on Integrations." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
            <MetricCard label="Daily Sales" sub="Merchandise only" s={view.merch.split} icon="shopping_bag" />
            <MetricCard label="Lottery / Lotto" sub="incl. payouts" s={view.lotto.split} icon="confirmation_number" />
            <MetricCard label="Fuel Sales" sub={`${fmtNumber(view.fuel.gallons)} gal`} s={view.fuel.split} icon="local_gas_station" />
            <MetricCard label="Total Sales" sub="vs previous period" s={view.total} icon="payments" trend={pctChange(view.total.total, prevTotal)} highlight />
            <CountCard label="Customers" count={customers} sub={customers > 0 ? `${fmtMoney(avgBasket)} avg basket` : "count not synced"} icon="groups" />
          </div>

          <SalesSection title="Merchandise Sales" s={view.merch.split} className="mb-6">
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
