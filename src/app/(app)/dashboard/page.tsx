import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { money, pctChange } from "@/lib/calc";
import { fmtMoney, fmtNumber, gradeLabel } from "@/lib/format";
import { rangeFor, customRange, previousRange, type PeriodKey, type Range } from "@/lib/period";
import { buildSalesView } from "@/lib/salesView";
import { getReportData } from "@/lib/reports";
import { getTaxRange, getTenderRange, getPromoRange } from "@/lib/integrations/sync";
import { getLotteryManualRange } from "@/lib/lottery";
import { getCreditManualRange } from "@/lib/credit";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { MetricCard, LotteryReconcileCard, LotteryReconcileStrip, ManualCreditPanel, TotalSalesBar, SalesSection, DeptTable, FuelTable, SalesTrend } from "@/components/SalesSections";
import PeriodBar from "@/components/PeriodBar";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const loc = await getActiveLocationId();
  const locWhere = loc ? { locationId: loc } : {};

  // Resolve the window. With no explicit selection, default to this month.
  let range: Range;
  let period: PeriodKey | "" = "";
  if (sp.from && sp.to) {
    range = customRange(sp.from, sp.to);
  } else if (sp.period) {
    period = sp.period as PeriodKey;
    range = rangeFor(period);
  } else {
    period = "mtd";
    range = rangeFor("mtd");
  }
  const prev = previousRange(range);
  const showProfit = can(session.role, "viewProfit");

  // Trend window: per-day totals across the range, capped at 31 bars (most recent).
  const dayMs = 86400000;
  const trendDays = Math.min(31, Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / dayMs)));
  const trendStart = new Date(range.end.getTime() - trendDays * dayMs);
  trendStart.setHours(0, 0, 0, 0);

  const [sales, fuelSales, prevSales, trendRows, report, vendorOwed, openAlerts] = await Promise.all([
    prisma.sale.findMany({
      where: { ...locWhere, date: { gte: range.start, lt: range.end } },
      select: { paymentType: true, amount: true, refund: true, category: true, note: true },
    }),
    prisma.fuelSale.findMany({
      where: { ...locWhere, date: { gte: range.start, lt: range.end } },
      select: { grade: true, gallons: true, total: true, pricePerGallon: true },
    }),
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: prev.start, lt: prev.end } }, select: { amount: true } }),
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: trendStart, lt: range.end } }, select: { amount: true, date: true } }),
    showProfit ? getReportData(range, loc) : Promise.resolve(null),
    prisma.vendor.aggregate({ _sum: { balanceOwed: true } }),
    prisma.alert.count({ where: { read: false, ...(loc ? { locationId: loc } : {}) } }),
  ]);

  const view = buildSalesView(sales, fuelSales);
  const prevTotal = money(prevSales.reduce((s, x) => s + x.amount, 0));

  // Sales Tax comes from the POS (report 36) only — never estimated. 0 until synced.
  const [realTax, prevRealTax] = await Promise.all([
    getTaxRange(loc ?? "", range.start, range.end),
    getTaxRange(loc ?? "", prev.start, prev.end),
  ]);
  const taxIsReal = realTax > 0;
  const salesTax = money(realTax);

  // Total Sales = POS sales (Daily + Fuel + Lottery + Sales Tax). Cash/Credit show
  // the actual tender (Safe Drop / Credit Card Jobber); the gap is the Short/Over.
  const posSales = money(view.total.total + salesTax);
  const prevPosSales = money(prevTotal + (prevRealTax > 0 ? money(prevRealTax) : 0));

  // Actual tender (Safe Drop = cash, Credit Card Jobber = card).
  const [tender, promo, manualRaw] = await Promise.all([
    getTenderRange(loc ?? "", range.start, range.end),
    getPromoRange(loc ?? "", range.start, range.end),
    getLotteryManualRange(loc ?? "", range.start, range.end),
  ]);
  const cashRatio = view.total.total > 0 ? view.total.cash / view.total.total : 0;
  const totalSplit = tender
    ? { cash: money(tender.cash), card: money(tender.card), total: posSales }
    : {
        cash: money(view.total.cash + salesTax * cashRatio),
        card: money(view.total.card + salesTax * (1 - cashRatio)),
        total: posSales,
      };

  // Lottery: system (POS) breakdown vs the employee's manual entry → short/over.
  let lottoSales = 0, lottoPayout = 0;
  for (const d of view.lotto.depts) {
    if (d.sales >= 0) lottoSales += d.sales;
    else lottoPayout += -d.sales;
  }
  const systemLotto = { sales: money(lottoSales), payout: money(lottoPayout), net: view.lotto.split.total };
  const manualLotto = manualRaw
    ? { sales: manualRaw.sales, payout: manualRaw.payout, credit: manualRaw.credit, net: money(manualRaw.sales - manualRaw.payout - manualRaw.credit) }
    : null;
  const lottoOver = manualLotto ? money(systemLotto.net - manualLotto.net) : 0;
  const creditManual = await getCreditManualRange(loc ?? "", range.start, range.end);
  const houseTotal = creditManual ? creditManual.house.reduce((s, h) => s + h.amount, 0) : 0;
  const payoutTotal = creditManual ? creditManual.payouts.reduce((s, h) => s + h.amount, 0) : 0;

  // Short/Over: POS sales (expected) less everything actually collected/paid, plus
  // the lottery short/over. Each part is a signed contribution to the short/over.
  const reconParts = [
    { label: "Credit card", value: totalSplit.card },
    { label: "Safe drop", value: totalSplit.cash },
    { label: "EBT", value: creditManual?.ebt ?? 0 },
    { label: "Other credit", value: creditManual?.otherCredit ?? 0 },
    { label: "Payout in cash", value: payoutTotal },
    { label: "House account", value: houseTotal },
    // Signed: lottery short (negative) subtracts, lottery over (positive) adds.
    { label: "Lottery short/over", value: lottoOver },
    { label: "POS sales", value: -posSales },
  ];
  const shortOver = money(reconParts.reduce((s, p) => s + p.value, 0));

  const trend: { label: string; value: number; date: string }[] = [];
  for (let i = 0; i < trendDays; i++) {
    const d = new Date(trendStart);
    d.setDate(d.getDate() + i);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const sum = trendRows.reduce((s, x) => (x.date >= d && x.date < next ? s + x.amount : s), 0);
    trend.push({ label: String(d.getDate()), value: money(sum), date: d.toISOString().slice(0, 10) });
  }

  const empty = sales.length === 0 && fuelSales.length === 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Store overview · ${range.label}`}
      />

      <div className="mb-6">
        <PeriodBar period={period} from={sp.from} to={sp.to} path="/dashboard" />
      </div>

      {empty ? (
        <Card className="p-8">
          <EmptyState icon="query_stats" title="No sales in this period" hint="Pick another period or a custom range, or run a sync/backfill on Integrations." />
        </Card>
      ) : (
        <>
          {/* Sales summary (clickable to sections) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <MetricCard label="Daily Sales" sub="Merchandise only (net of promotions)" s={view.merch.split} icon="shopping_bag" href="#merch"
              cells={[
                { label: "Promotions", value: promo.merch > 0 ? `-${fmtMoney(promo.merch)}` : fmtMoney(0), tone: "error" },
                { label: "Sales Tax", value: fmtMoney(salesTax) },
              ]} />
            <MetricCard label="Fuel Sales" sub={`${fmtNumber(view.fuel.gallons)} gal`} s={view.fuel.split} icon="local_gas_station" href="#fuel"
              cells={[
                { label: "Promotions", value: promo.fuel > 0 ? `-${fmtMoney(promo.fuel)}` : fmtMoney(0), tone: "error" },
                ...view.fuel.byGrade.map((g) => ({ label: gradeLabel(g.grade), value: `${fmtNumber(g.gallons)} gal` })),
              ]} />
            <LotteryReconcileCard className="sm:col-span-2" system={systemLotto} manual={manualLotto} over={lottoOver} entryHref="/lottery" />
          </div>

          <TotalSalesBar
            s={totalSplit}
            trend={pctChange(posSales, prevPosSales)}
            sub={tender ? "Cash = Safe Drop · Credit = card batch · vs previous period" : "incl. sales tax · vs previous period"}
            partsLabel="POS sales"
            parts={[
              { label: "Daily", value: view.merch.split.total },
              { label: "Fuel", value: view.fuel.split.total },
              { label: "Lottery", value: view.lotto.split.total },
              { label: "Sales Tax", value: salesTax },
            ]}
            reconcile={tender ? { parts: reconParts, shortOver } : undefined}
          />

          <ManualCreditPanel className="mb-6" data={creditManual} entryHref="/credit-entry" />

          {/* Store health: profit / expenses / vendor dues / alerts */}
          {report && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <Stat label="Net Sales" value={fmtMoney(report.pnl.netSales)} />
              <Stat label="COGS" value={fmtMoney(report.pnl.cogs)} />
              <Stat label="Gross Profit" value={fmtMoney(report.pnl.grossProfit)} tone="good" />
              <Stat label="Expenses" value={fmtMoney(report.pnl.operatingExpenses)} tone="bad" href="/expenses" />
              <Stat label="Net Profit" value={fmtMoney(report.pnl.netProfit)} tone={report.pnl.netProfit >= 0 ? "good" : "bad"} />
              <Stat label="Sales Tax" value={taxIsReal ? fmtMoney(salesTax) : "—"} sub={taxIsReal ? "from POS closing" : "not synced — run POS sync"} />
            </div>
          )}

          {/* Quick ops row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Stat label="Owed to Vendors" value={fmtMoney(vendorOwed._sum.balanceOwed ?? 0)} tone="bad" href="/vendors" />
            <Stat label="Open Alerts" value={String(openAlerts)} tone={openAlerts > 0 ? "warn" : undefined} href="/alerts" />
            <Stat label="Refunds" value={fmtMoney(view.merch.refund)} tone={view.merch.refund > 0 ? "bad" : undefined} />
            <Stat label="Fuel Volume" value={`${fmtNumber(view.fuel.gallons)} gal`} />
          </div>

          {/* Trend */}
          <Card className="p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-on-surface">Total Sales — daily trend</h3>
              <span className="text-body-sm text-on-surface-variant">Tap a bar to open that day</span>
            </div>
            <SalesTrend data={trend} />
          </Card>

          <SalesSection id="merch" title="Merchandise Sales" s={view.merch.split} className="mb-6">
            <DeptTable rows={view.merch.depts} total={view.merch.split.total} refundTotal={view.merch.refund} />
          </SalesSection>

          <SalesSection id="fuel" title="Fuel Sales" s={view.fuel.split} extra={`${fmtNumber(view.fuel.gallons)} gal`} className="mb-6">
            <FuelTable byGrade={view.fuel.byGrade} gallons={view.fuel.gallons} total={view.fuel.split.total} />
          </SalesSection>

          <SalesSection id="lottery" title="Lottery / Lotto Sales & Payouts" s={view.lotto.split}>
            <DeptTable rows={view.lotto.depts} total={view.lotto.split.total} refundTotal={0} allowNegative />
            <LotteryReconcileStrip manual={manualLotto} over={lottoOver} entryHref="/lottery" />
          </SalesSection>
        </>
      )}
    </div>
  );
}

function Stat({
  label, value, sub, tone, href,
}: {
  label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn"; href?: string;
}) {
  const color = tone === "good" ? "text-secondary" : tone === "bad" ? "text-error" : tone === "warn" ? "text-tertiary" : "text-on-surface";
  const card = (
    <Card className={`p-4 h-full ${href ? "hover:shadow-floating cursor-pointer transition-shadow" : ""}`}>
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className={`tabular text-lg font-bold mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-body-sm text-on-surface-variant">{sub}</div>}
    </Card>
  );
  return href ? <a href={href} className="block">{card}</a> : card;
}
