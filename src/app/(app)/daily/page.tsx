import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { money, pctChange } from "@/lib/calc";
import { fmtNumber, fmtDate, fmtMoney, gradeLabel } from "@/lib/format";
import { customRange, previousRange } from "@/lib/period";
import { cookies } from "next/headers";
import { yesterdayISO } from "@/lib/day";
import { buildSalesView } from "@/lib/salesView";
import { getTaxRange, getTenderRange, getPromoRange } from "@/lib/integrations/sync";
import { getLotteryManual, getLotteryManualRange } from "@/lib/lottery";
import { getCreditManual, getCreditManualRange } from "@/lib/credit";
import { getReceipts } from "@/lib/receipts";
import { signedUrls } from "@/lib/storage";
import { getCashDay } from "@/lib/cash";
import EditCashButton from "../cash/EditCashButton";
import EditLotteryButton from "../lottery/EditLotteryButton";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { MetricCard, LotteryReconcileCard, LotteryReconcileStrip, ManualCreditPanel, TotalSalesBar, SalesSection, DeptTable, FuelTable, SalesTrend } from "@/components/SalesSections";
import DailyActions from "./DailyActions";
import DailyDateBar from "./DailyDateBar";

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
    const vtz = (await cookies()).get("vtz")?.value;
    const dateISO = sp.date || yesterdayISO(vtz || undefined);
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

  const [sales, fuelSales, prevSales, prevFuel, trendSales, trendFuel, trendTaxRows] = await Promise.all([
    prisma.sale.findMany({
      where: { ...locWhere, date: { gte: range.start, lt: range.end } },
      select: { paymentType: true, amount: true, refund: true, category: true, note: true },
    }),
    prisma.fuelSale.findMany({ where: { ...locWhere, date: { gte: range.start, lt: range.end } }, select: { grade: true, gallons: true, total: true, pricePerGallon: true } }),
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: prev.start, lt: prev.end } }, select: { paymentType: true, amount: true, refund: true, category: true, note: true } }),
    prisma.fuelSale.findMany({ where: { ...locWhere, date: { gte: prev.start, lt: prev.end } }, select: { grade: true, gallons: true, total: true, pricePerGallon: true } }),
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: trendStart, lt: range.end } }, select: { paymentType: true, amount: true, refund: true, category: true, note: true, date: true } }),
    prisma.fuelSale.findMany({ where: { ...locWhere, date: { gte: trendStart, lt: range.end } }, select: { grade: true, gallons: true, total: true, pricePerGallon: true, date: true } }),
    loc ? prisma.setting.findMany({ where: { key: { startsWith: `tax:${loc}:` } } }) : Promise.resolve([] as { key: string; value: string }[]),
  ]);

  const view = buildSalesView(sales, fuelSales);
  const prevView = buildSalesView(prevSales, prevFuel);

  // Sales Tax comes from the POS (report 36) only — never estimated. It stays 0
  // (shown as "not synced") until the day is pulled from Modisoft.
  const [realTax, prevRealTax] = await Promise.all([
    getTaxRange(loc ?? "", range.start, range.end),
    getTaxRange(loc ?? "", prev.start, prev.end),
  ]);
  const taxIsReal = realTax > 0;
  const salesTax = money(realTax);
  const prevSalesTax = money(prevRealTax);

  // Total Sales = the POS sales (Daily + Fuel + Lottery + Sales Tax). Cash/Credit
  // show the actual tender (Safe Drop / Credit Card Jobber); any gap between them
  // and the total is the Short/Over below.
  const posSales = money(view.total.total + salesTax);
  const prevPosSales = money(prevView.total.total + prevSalesTax);

  // Actual tender from the Daily Entry (Safe Drop = cash, Credit Card Jobber = card).
  const [tender, promo] = await Promise.all([
    getTenderRange(loc ?? "", range.start, range.end),
    getPromoRange(loc ?? "", range.start, range.end),
  ]);
  const cashRatio = view.total.total > 0 ? view.total.cash / view.total.total : 0;
  const totalSplit = tender
    ? { cash: money(tender.cash), card: money(tender.card), total: posSales }
    : {
        cash: money(view.total.cash + salesTax * cashRatio),
        card: money(view.total.card + salesTax * (1 - cashRatio)),
        total: posSales,
      };

  // Lottery breakdown: gross lottery sales (positive depts), lotto payout
  // (negative depts), and the difference (net = what feeds Total Sales).
  let lottoSales = 0, lottoPayout = 0;
  for (const d of view.lotto.depts) {
    if (d.sales >= 0) lottoSales += d.sales;
    else lottoPayout += -d.sales;
  }
  lottoSales = money(lottoSales);
  lottoPayout = money(lottoPayout);
  const systemLotto = { sales: lottoSales, payout: lottoPayout, net: view.lotto.split.total };

  // Employee's manual lottery entry for the day/range → short/over vs the system.
  const manualRaw = isRange
    ? await getLotteryManualRange(loc ?? "", range.start, range.end)
    : await getLotteryManual(loc ?? "", navDate);
  const manualLotto = manualRaw
    ? { sales: manualRaw.sales, payout: manualRaw.payout, net: money(manualRaw.sales - manualRaw.payout) }
    : null;
  const lottoOver = manualLotto ? money(systemLotto.net - manualLotto.net) : 0;

  // Employee's manual credit entry (EBT / other credit / cash payout / house accounts).
  const creditManual = isRange
    ? await getCreditManualRange(loc ?? "", range.start, range.end)
    : await getCreditManual(loc ?? "", navDate);
  const houseTotal = creditManual ? creditManual.house.reduce((s, h) => s + h.amount, 0) : 0;
  const payoutTotal = creditManual ? creditManual.payouts.reduce((s, h) => s + h.amount, 0) : 0;
  const creditReceipts = !isRange ? await signedUrls(await getReceipts(loc ?? "", "credit", navDate)) : [];

  // Short/Over: POS sales (expected) less everything actually collected/paid, with
  // the lottery short/over rolled in. Each part is a signed contribution.
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

  // Per-day sales trend across the window, broken down into Daily / Fuel /
  // Lottery / Sales Tax so each bar shows its composition (oldest → newest).
  const taxByDayTrend = new Map<string, number>();
  for (const r of trendTaxRows) taxByDayTrend.set(r.key.split(":").pop()!, Number(r.value) || 0);
  const trendSalesByDay = new Map<string, typeof trendSales>();
  const trendFuelByDay = new Map<string, typeof trendFuel>();
  for (const s of trendSales) {
    const k = s.date.toISOString().slice(0, 10);
    (trendSalesByDay.get(k) ?? trendSalesByDay.set(k, []).get(k)!).push(s);
  }
  for (const f of trendFuel) {
    const k = f.date.toISOString().slice(0, 10);
    (trendFuelByDay.get(k) ?? trendFuelByDay.set(k, []).get(k)!).push(f);
  }

  const trend7: { label: string; value: number; date: string; daily: number; fuel: number; lottery: number; tax: number }[] = [];
  for (let i = 0; i < trendDays; i++) {
    const d = new Date(trendStart);
    d.setDate(d.getDate() + i);
    const dISO = d.toISOString().slice(0, 10);
    const dv = buildSalesView(trendSalesByDay.get(dISO) ?? [], trendFuelByDay.get(dISO) ?? []);
    const dTax = taxByDayTrend.has(dISO) ? money(taxByDayTrend.get(dISO)!) : 0; // POS only
    const daily = money(dv.merch.split.total);
    const fuel = money(dv.fuel.split.total);
    const lottery = money(dv.lotto.split.total);
    const value = money(daily + fuel + lottery + dTax);
    trend7.push({ label: String(d.getDate()), value, date: dISO, daily, fuel, lottery, tax: dTax });
  }

  const empty = sales.length === 0 && fuelSales.length === 0;
  const comparisonSub = isRange ? "vs previous period" : "vs previous day";

  // Single-day cash is editable inline (manual override wins over the Safe Drop).
  const canEditManual = can(session.role, "enterSales");
  const cashDay = !isRange && loc ? await getCashDay(loc, navDate) : null;

  return (
    <div>
      <PageHeader
        title="Daily Sales"
        subtitle={`POS closing summary · ${label}`}
        actions={<DailyActions query={exportQs} canExport={can(session.role, "exportReports")} />}
      />

      <DailyDateBar date={navDate} isRange={isRange} from={sp.from} to={sp.to} />

      {empty ? (
        <Card className="p-8">
          <EmptyState icon="event_busy" title="No sales for this day" hint="Pick another date, or run a sync/backfill on Integrations." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <MetricCard label="Daily Sales" sub="Merchandise only (net of promotions)" s={view.merch.split} icon="shopping_bag" trend={pctChange(view.merch.split.total, prevView.merch.split.total)} href="#merch"
              cells={[
                { label: "Promotions", value: promo.merch > 0 ? `-${fmtMoney(promo.merch)}` : fmtMoney(0), tone: "error" },
                { label: "Sales Tax (POS)", value: taxIsReal ? fmtMoney(salesTax) : "— not synced" },
              ]} />
            <MetricCard label="Fuel Sales" sub={`${fmtNumber(view.fuel.gallons)} gal`} s={view.fuel.split} icon="local_gas_station" trend={pctChange(view.fuel.split.total, prevView.fuel.split.total)} href="#fuel"
              cells={[
                { label: "Promotions", value: promo.fuel > 0 ? `-${fmtMoney(promo.fuel)}` : fmtMoney(0), tone: "error" },
                ...view.fuel.byGrade.map((g) => ({ label: gradeLabel(g.grade), value: `${fmtNumber(g.gallons)} gal` })),
              ]} />
            <LotteryReconcileCard
              className="sm:col-span-2"
              system={systemLotto}
              manual={manualLotto}
              over={lottoOver}
              trend={pctChange(view.lotto.split.total, prevView.lotto.split.total)}
              entryHref={`/lottery?date=${navDate}`}
              manualEdit={!isRange && canEditManual && manualLotto ? (
                <EditLotteryButton date={navDate} sales={manualLotto.sales} payout={manualLotto.payout} />
              ) : undefined}
            />
          </div>

          <TotalSalesBar
            s={totalSplit}
            trend={pctChange(posSales, prevPosSales)}
            sub={tender ? `Cash = Safe Drop · Credit = card batch · ${comparisonSub}` : `incl. sales tax · ${comparisonSub}`}
            partsLabel="POS sales"
            parts={[
              { label: "Daily", value: view.merch.split.total },
              { label: "Fuel", value: view.fuel.split.total },
              { label: "Lottery", value: view.lotto.split.total },
              { label: "Sales Tax", value: salesTax },
            ]}
            reconcile={tender ? { parts: reconParts, shortOver } : undefined}
            cashEdit={!isRange && canEditManual && cashDay ? (
              <EditCashButton date={navDate} pos={cashDay.pos} manual={cashDay.manual} effective={cashDay.effective} />
            ) : undefined}
          />

          <ManualCreditPanel className="mb-6" data={creditManual} entryHref={`/credit-entry?date=${navDate}`} receipts={creditReceipts} />

          <Card className="p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-on-surface">{isRange ? "Daily Total Sales" : "Last 7 days — Total Sales"}</h3>
              <span className="text-body-sm text-on-surface-variant">Tap a bar to open that day · {label}</span>
            </div>
            <SalesTrend data={trend7} />
          </Card>

          <SalesSection id="merch" title="Daily Sales — Merchandise" s={view.merch.split} extra={taxIsReal ? `Sales tax = ${fmtMoney(salesTax)}` : "Sales tax not synced from POS yet"} className="mb-6">
            <DeptTable rows={view.merch.depts} total={view.merch.split.total} refundTotal={view.merch.refund} />
          </SalesSection>

          <SalesSection id="fuel" title="Fuel Sales" s={view.fuel.split} extra={promo.fuel > 0 ? `${fmtNumber(view.fuel.gallons)} gal · incl. ${fmtMoney(promo.fuel)} promotions` : `${fmtNumber(view.fuel.gallons)} gal`} className="mb-6">
            <FuelTable byGrade={view.fuel.byGrade} gallons={view.fuel.gallons} total={view.fuel.split.total} promotions={promo.fuel} />
          </SalesSection>

          <SalesSection id="lottery" title="Lottery / Lotto Sales & Payouts" s={view.lotto.split}>
            <DeptTable rows={view.lotto.depts} total={view.lotto.split.total} refundTotal={0} allowNegative />
            <LotteryReconcileStrip
              manual={manualLotto}
              over={lottoOver}
              entryHref={`/lottery?date=${navDate}`}
              manualEdit={!isRange && canEditManual && manualLotto ? (
                <EditLotteryButton date={navDate} sales={manualLotto.sales} payout={manualLotto.payout} />
              ) : undefined}
            />
          </SalesSection>
        </>
      )}
    </div>
  );
}
