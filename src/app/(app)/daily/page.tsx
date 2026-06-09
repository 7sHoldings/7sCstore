import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { money, pctChange } from "@/lib/calc";
import { fmtNumber, fmtDate, fmtMoney } from "@/lib/format";
import { customRange, previousRange } from "@/lib/period";
import { buildSalesView } from "@/lib/salesView";
import { getTaxRate } from "@/lib/settings";
import { getTaxRange, getTenderRange, getPromoRange } from "@/lib/integrations/sync";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { MetricCard, InfoCard, TotalSalesBar, SalesSection, DeptTable, FuelTable, SalesTrend } from "@/components/SalesSections";
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
  const taxRate = await getTaxRate();
  const estTax = money(view.merch.taxable * (taxRate / 100));

  // Prefer the REAL Sales Tax pulled from Modisoft (report 36); fall back to the
  // rate estimate for days that haven't been re-synced yet.
  const realTax = await getTaxRange(loc ?? "", range.start, range.end);
  const taxIsReal = realTax > 0;
  const salesTax = taxIsReal ? money(realTax) : estTax;

  // Actual tender from the Daily Entry (Safe Drop = cash, Credit Card Jobber =
  // card) drives the Total Sales card when synced. The merch + fuel + lottery +
  // tax formula is shown as the POS-sales breakdown beneath it. Until a day is
  // synced, fall back to the sales formula with tax spread by tender ratio.
  const [tender, prevTender, promo] = await Promise.all([
    getTenderRange(loc ?? "", range.start, range.end),
    getTenderRange(loc ?? "", prev.start, prev.end),
    getPromoRange(loc ?? "", range.start, range.end),
  ]);
  const cashRatio = view.total.total > 0 ? view.total.cash / view.total.total : 0;
  const totalSplit = tender
    ? { cash: money(tender.cash), card: money(tender.card), total: money(tender.cash + tender.card) }
    : {
        cash: money(view.total.cash + salesTax * cashRatio),
        card: money(view.total.card + salesTax * (1 - cashRatio)),
        total: money(view.total.total + salesTax),
      };
  const prevTotalWithTax = prevTender ? money(prevTender.cash + prevTender.card) : prevView.total.total;

  // Lottery breakdown: gross lottery sales (positive depts), lotto payout
  // (negative depts), and the difference (net = what feeds Total Sales).
  let lottoSales = 0, lottoPayout = 0;
  for (const d of view.lotto.depts) {
    if (d.sales >= 0) lottoSales += d.sales;
    else lottoPayout += -d.sales;
  }
  lottoSales = money(lottoSales);
  lottoPayout = money(lottoPayout);

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <MetricCard label="Daily Sales" sub="Merchandise only (net of promotions)" s={view.merch.split} icon="shopping_bag" trend={pctChange(view.merch.split.total, prevView.merch.split.total)} href="#merch"
              cells={[{ label: "Promotions", value: promo.merch > 0 ? `-${fmtMoney(promo.merch)}` : fmtMoney(0), tone: "error" }]} />
            <MetricCard label="Fuel Sales" sub={`${fmtNumber(view.fuel.gallons)} gal`} s={view.fuel.split} icon="local_gas_station" trend={pctChange(view.fuel.split.total, prevView.fuel.split.total)} href="#fuel"
              cells={[{ label: "Promotions", value: promo.fuel > 0 ? `-${fmtMoney(promo.fuel)}` : fmtMoney(0), tone: "error" }]} />
            <MetricCard label="Lottery / Lotto" sub="net = lottery − payout" s={view.lotto.split} icon="confirmation_number" trend={pctChange(view.lotto.split.total, prevView.lotto.split.total)} href="#lottery"
              cells={[
                { label: "Lottery", value: fmtMoney(lottoSales) },
                { label: "Payout", value: lottoPayout > 0 ? `-${fmtMoney(lottoPayout)}` : fmtMoney(0), tone: "error" },
              ]} />
            <InfoCard label="Sales Tax" value={fmtMoney(salesTax)} sub={taxIsReal ? "from POS closing" : `est. @ ${taxRate}% (sync for actual)`} icon="receipt_long" href="#merch" />
          </div>

          <TotalSalesBar
            s={totalSplit}
            trend={pctChange(totalSplit.total, prevTotalWithTax)}
            sub={tender ? `Cash = Safe Drop · Credit = card batch · ${comparisonSub}` : `incl. sales tax · ${comparisonSub}`}
            partsLabel="POS sales"
            parts={[
              { label: "Daily", value: view.merch.split.total },
              { label: "Fuel", value: view.fuel.split.total },
              { label: "Lottery", value: view.lotto.split.total },
              { label: "Sales Tax", value: salesTax },
            ]}
          />

          <Card className="p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-on-surface">{isRange ? "Daily Total Sales" : "Last 7 days — Total Sales"}</h3>
              <span className="text-body-sm text-on-surface-variant">Tap a bar to open that day · {label}</span>
            </div>
            <SalesTrend data={trend7} />
          </Card>

          <SalesSection id="merch" title="Daily Sales — Merchandise" s={view.merch.split} extra={taxIsReal ? `Sales tax = ${fmtMoney(salesTax)}` : `Est. tax @ ${taxRate}% = ${fmtMoney(estTax)}`} className="mb-6">
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
