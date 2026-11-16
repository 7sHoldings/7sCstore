import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { todayISO } from "@/lib/day";
import { gradeLabel } from "@/lib/format";
import {
  chronological, compareByKey, compareWindows, deltaPerDay, defaultMonth, delta, isMonth, monthLabel, shiftMonth,
  type CompareMode, type Delta, type Tone,
} from "@/lib/compare";
import { getWindowFigures, type WindowFigures } from "@/lib/monthCompare";
import { buildMonthsReport, type MonthsReport } from "@/lib/monthsReport";
import { Card, PageHeader, EmptyState, Icon, Banner } from "@/components/ui";
import {
  CompareTable, MonthGrid, Num, Section, ToneLegend, toneText, fmtVal,
  type CompareRow, type Unit,
} from "@/components/compare";
import SummaryFilter from "@/components/SummaryFilter";
import SummaryExport from "@/components/SummaryExport";
import SectionControls from "@/components/SectionControls";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const GRADES = ["REGULAR", "PREMIUM", "DIESEL"];

export default async function MonthlySummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; vs?: string; b?: string; full?: string; view?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  if (!loc) return <Card className="p-8"><EmptyState icon="table_chart" title="No location" /></Card>;
  const sp = await searchParams;
  const storeName = (await prisma.location.findUnique({ where: { id: loc }, select: { name: true } }))?.name ?? "";

  const today = todayISO();
  const month = isMonth(sp.month) ? sp.month : defaultMonth(today);
  const view: "months" | "compare" = sp.view === "compare" ? "compare" : "months";
  const mode: CompareMode = sp.vs === "lastyear" ? "lastyear" : sp.vs === "custom" && isMonth(sp.b) ? "custom" : "prev";
  const full = sp.full === "1";
  const w = compareWindows(month, mode, sp.b, today, full);
  const running = today.slice(0, 7) === month;
  const year = month.slice(0, 4);
  const from = isMonth(sp.from) && sp.from <= month ? sp.from : `${year}-01`;
  const yearLabel = from === month ? monthLabel(month, true) : `${monthLabel(from, true)} – ${monthLabel(month, true)}`;

  const query = new URLSearchParams({
    month, vs: w.mode,
    ...(w.mode === "custom" ? { b: w.b.ym } : {}),
    ...(full ? { full: "1" } : {}),
    ...(view === "compare" ? { view: "compare" } : {}),
    ...(view === "months" && from !== `${year}-01` ? { from } : {}),
  }).toString();
  // Per-section screenshot: file name + the caption printed on the picture.
  const cmp = chronological(w);
  const periodLabel = view === "months" ? yearLabel : `${cmp.older.label} vs ${cmp.newer.label}`;
  const shotFor = (name: string) => ({
    fileName: `${name}-${periodLabel}`.replace(/[^\w]+/g, "-").replace(/-+$/, ""),
    caption: `7sCstores · ${storeName} · ${periodLabel} · green = better, red = worse`,
  });
  const deptHref = (name: string) => `/summary/dept/${encodeURIComponent(name)}?${query}`;

  const filter = (
    <Card className="p-4 mb-4">
      <SummaryFilter
        key={`${view}|${month}|${from}|${w.mode}|${w.b.ym}|${full}`}
        month={month}
        from={from}
        vs={w.mode}
        b={w.b.ym}
        full={full}
        running={running}
        view={view}
        thisMonth={today.slice(0, 7)}
      />
      <div className="mt-3 pt-3 border-t border-outline-variant/40 flex flex-wrap items-center justify-between gap-2">
        <ToneLegend better={view === "compare" ? `${cmp.newer.label} better than ${cmp.older.label}` : undefined} />
        {view === "compare" && w.toDate && (
          <span className="text-body-sm text-on-surface-variant">
            <Icon name="info" className="text-[16px] align-[-3px] mr-1" />
            {monthLabel(today.slice(0, 7))} is still running — comparing the same {w.a.days} complete days of both months.
          </span>
        )}
      </div>
    </Card>
  );

  const header = (
    <PageHeader
      title="Monthly Summary"
      subtitle={view === "months" ? `Month by month · ${monthLabel(from)} to ${monthLabel(month)}` : `${cmp.older.label}  vs  ${cmp.newer.label}`}
      actions={
        <a href="/summary/year" className="ft-btn-secondary inline-flex items-center gap-1.5">
          <Icon name="table_chart" className="text-[18px]" /> Year P&amp;L table
        </a>
      }
    />
  );

  const jumpTabs = (
    <nav className="sticky top-14 lg:top-16 z-10 -mx-4 px-4 py-2 mb-4 bg-background/90 backdrop-blur border-b border-outline-variant/40 overflow-x-auto">
      <div className="flex gap-1.5 w-max">
        {[
          ["overview", "Store totals"], ["departments", "Departments"], ["fuel", "Gas"], ["lottery", "Lottery"],
          ["shorts", "Short / Over"], ["expenses", "Expenses"], ["profit", "Profit"], ["profitout", "Profit taken out"], ["master", "Whole store"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="px-3 py-1.5 rounded-full text-body-sm font-medium bg-surface-container-lowest border border-outline-variant/60 text-on-surface hover:bg-surface-container whitespace-nowrap">
            {label}
          </a>
        ))}
      </div>
    </nav>
  );

  // =========================================================================
  // ALL MONTHS view — January → selected month, every number vs month before
  // =========================================================================
  if (view === "months") {
    const report = await buildMonthsReport(loc, from, month, today);
    if (!report.hasData) {
      return (
        <div>
          {header}
          {filter}
          <Card className="p-8"><EmptyState icon="query_stats" title={`No sales recorded for ${yearLabel}`} hint="Pick another month." /></Card>
        </div>
      );
    }
    return (
      <div>
        {header}
        {filter}
        {jumpTabs}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <SummaryExport targetId="summary-export" fileName={`Monthly-Summary-${month}`} excelHref={`/api/summary/export?month=${month}&from=${from}`} />
          <SectionControls />
        </div>

        <div id="summary-export">
          <ExportTitle title={`Monthly Summary — ${yearLabel}`} store={storeName} />
          <ProjectionNote report={report} />
          {report.sections.map((s) => {
            const grid = s.empty ? (
              <EmptyState icon={s.icon} title={s.empty} />
            ) : (
              <MonthGrid
                months={report.months}
                projLabels={report.projLabels}
                rows={s.rows.map((r) => ({
                  ...r,
                  label: r.dept ? <a key={r.dept} href={deptHref(r.dept)} className="text-primary font-medium hover:underline">{r.label}</a> : r.label,
                }))}
              />
            );
            if (s.id !== "master") {
              return (
                <Section key={s.id} id={s.id} title={s.title} icon={s.icon} note={s.note || undefined} shot={shotFor(s.title.split(" —")[0])} defaultOpen={s.id === "overview"}>
                  {grid}
                </Section>
              );
            }
            // The whole-store table gets its own screenshot button.
            return (
              <div key={s.id} id="master" className="scroll-mt-32">
                <div className="sm:rounded-xl sm:border-2 sm:border-primary/30 sm:bg-primary/[0.03] sm:p-4 mb-6">
                  <SummaryExport
                    targetId="master-export"
                    fileName={`Whole-Store-Summary-${month}`}
                    exportClass="exporting-master"
                    imageLabel="Screenshot this summary"
                  />
                  <div id="master-export">
                    <div className="hidden [.exporting-master_&]:block mb-3">
                      <div className="text-headline-lg font-bold text-primary whitespace-nowrap">Whole store summary — {yearLabel}</div>
                      <div className="text-body-sm text-on-surface-variant">7sCstores · {storeName} · green = better than the month before, red = worse · shaded = projected</div>
                    </div>
                    <Section id="master-table" title={s.title} icon={s.icon} note={s.note}>
                      {grid}
                    </Section>
                  </div>
                </div>
              </div>
            );
          })}
          <Footnote />
        </div>
      </div>
    );
  }

  // =========================================================================
  // COMPARE 2 MONTHS view
  // =========================================================================
  // Tables read left → right in time: older month, newer month, change
  // (newer − older), whichever order the two months were picked in.
  const { older, newer } = chronological(w);
  const [A, B] = await Promise.all([getWindowFigures(loc, newer.start, newer.end), getWindowFigures(loc, older.start, older.end)]);
  const aShort = newer.label;
  const bShort = older.label;

  // Sales-type figures: colour and % on the daily average (31 vs 30 vs 28 days).
  const pd = (a: number, b: number) => deltaPerDay(a, b, newer.days, older.days);
  const d = {
    total: pd(A.posSales, B.posSales),
    merch: pd(A.merch, B.merch),
    fuel: pd(A.fuel, B.fuel),
    gallons: pd(A.gallons, B.gallons),
    lotto: pd(A.lottoNet, B.lottoNet),
    expenses: delta(A.expenses.total, B.expenses.total, false),
    profit: delta(A.profit, B.profit),
    short: delta(A.shortOver ?? 0, B.shortOver ?? 0),
  };
  const depts = compareByKey(
    A.depts.map((x) => ({ key: x.name, value: x.sales })),
    B.depts.map((x) => ({ key: x.name, value: x.sales }))
  );
  for (const r of depts) Object.assign(r, pd(r.a, r.b));
  const gradeOf = (f: WindowFigures, g: string) => f.fuelGrades.find((x) => x.grade === g);
  const gradeRows = GRADES.map((g) => ({ g, a: gradeOf(A, g), b: gradeOf(B, g) })).filter((x) => x.a || x.b);

  return (
    <div>
      {header}
      {filter}

      {(!A.hasSales || !B.hasSales) && (
        <Banner tone="info" icon="info">
          No sales are recorded for {!B.hasSales ? older.label : newer.label}, so its column shows $0. Pick another month to compare with.
        </Banner>
      )}

      {!A.hasSales && !B.hasSales ? (
        <Card className="p-8"><EmptyState icon="query_stats" title="No sales recorded for these months" hint="Pick other months." /></Card>
      ) : (
        <>
          {jumpTabs}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <SummaryExport targetId="summary-export" fileName={`Monthly-Summary-${older.ym}-vs-${newer.ym}`} excelHref={`/api/summary/export?month=${month}`} />
            <SectionControls />
          </div>
          <div id="summary-export">
          <ExportTitle title={`Monthly Summary — ${older.label} vs ${newer.label}`} store={storeName} />

          <Section id="overview" title="Store totals" icon="storefront" note={`${bShort} → ${aShort}`} shot={shotFor("Store-totals")}>
            <CompareTable
              aLabel={aShort}
              bLabel={bShort}
              rows={[
                { label: "Total sales", d: d.total, strong: true },
                { label: "Inside sales", d: d.merch },
                { label: "Gas sales", d: d.fuel },
                { label: "Gallons sold", d: d.gallons, unit: "gal" },
                { label: "Lottery net", d: d.lotto },
                { label: "Expenses", d: d.expenses },
                { label: "Short / Over", d: d.short },
                { label: "Gross profit % (target ≥ 30%)", d: delta(A.grossProfitPct ?? 0, B.grossProfitPct ?? 0), unit: "pct", threshold: 30 },
                { label: "Profit / Loss", d: d.profit, strong: true },
                { label: "Profit taken out", d: delta(A.profitTaken, B.profitTaken), neutral: true },
                { label: "Left after profit taken out", d: delta(A.profit - A.profitTaken, B.profit - B.profitTaken), strong: true },
              ]}
            />
          </Section>

          <Section id="departments" defaultOpen={false} title="Departments" icon="category" note="Tap a department to see its products" shot={shotFor("Departments")}>
            <CompareTable
              aLabel={aShort}
              bLabel={bShort}
              firstHead="Department"
              rows={[
                ...depts.map((r): CompareRow => ({
                  label: <a href={deptHref(r.key)} className="text-primary font-medium hover:underline">{r.key}</a>,
                  d: r,
                })),
                { label: "All inside sales", d: d.merch, strong: true },
              ]}
            />
          </Section>

          <Section id="fuel" defaultOpen={false} title="Gas — gallons & sales by grade" icon="local_gas_station" note="Mid-grade is split 50/50 into Regular and Premium" shot={shotFor("Gas")}>
            <CompareTable
              aLabel={aShort}
              bLabel={bShort}
              firstHead="Gallons"
              rows={[
                ...gradeRows.map((x): CompareRow => ({ label: gradeLabel(x.g), d: pd(x.a?.gallons ?? 0, x.b?.gallons ?? 0), unit: "gal" })),
                { label: "All grades", d: d.gallons, unit: "gal", strong: true },
              ]}
            />
            <div className="border-t border-outline-variant/50" />
            <CompareTable
              aLabel={aShort}
              bLabel={bShort}
              firstHead="Gas sales"
              rows={[
                ...gradeRows.map((x): CompareRow => ({ label: gradeLabel(x.g), d: pd(x.a?.total ?? 0, x.b?.total ?? 0) })),
                { label: "All grades", d: d.fuel, strong: true },
              ]}
            />
          </Section>

          <Section id="lottery" defaultOpen={false} title="Lottery / Lotto" icon="confirmation_number" shot={shotFor("Lottery")}>
            <CompareTable
              aLabel={aShort}
              bLabel={bShort}
              rows={[
                { label: "Lottery sales", d: pd(A.lotto.sales, B.lotto.sales) },
                { label: "Payouts (winners)", d: pd(A.lotto.payout, B.lotto.payout), neutral: true },
                { label: "Lottery net (POS)", d: pd(A.lotto.net, B.lotto.net), strong: true },
                { label: "Net entered by staff", d: delta(A.lotto.manual?.net ?? 0, B.lotto.manual?.net ?? 0), neutral: true },
                { label: "Lottery short / over", d: delta(A.lotto.over, B.lotto.over), strong: true },
              ]}
            />
          </Section>

          <Section id="shorts" defaultOpen={false} title="Short / Over — cash reconciliation" icon="balance" note="Money collected minus POS sales" shot={shotFor("Short-Over")}>
            {A.recon.length || B.recon.length ? (
              <CompareTable aLabel={aShort} bLabel={bShort} rows={[...reconRows(A.recon, B.recon), { label: "Short / Over", d: d.short, strong: true }]} />
            ) : (
              <EmptyState icon="balance" title="No cash/card totals for these months" />
            )}
          </Section>

          <Section id="expenses" defaultOpen={false} title="Expenses — where the money went" icon="receipt_long" note="Spending more shows red" shot={shotFor("Expenses")}>
            <ExpenseCompare A={A.expenses} B={B.expenses} aLabel={aShort} bLabel={bShort} />
            <div className="border-t border-outline-variant/50" />
            <CompareTable
              aLabel={aShort}
              bLabel={bShort}
              firstHead="Gross profit (like the Dashboard)"
              rows={[
                {
                  label: "Product buying % of inside sales (target ≤ 70%)",
                  d: delta(A.merch ? (A.expenses.inventory / A.merch) * 100 : 0, B.merch ? (B.expenses.inventory / B.merch) * 100 : 0, false),
                  unit: "pct",
                  threshold: 70,
                  lowerIsBetter: true,
                },
                { label: "Gross profit (inside sales − product buying)", d: pd(A.grossProfit, B.grossProfit) },
                { label: "Gross profit % (target ≥ 30%)", d: delta(A.grossProfitPct ?? 0, B.grossProfitPct ?? 0), unit: "pct", strong: true, threshold: 30 },
              ]}
            />
          </Section>

          <Section id="profit" defaultOpen={false} title="Profit / Loss" icon="account_balance_wallet" note="Same formula as the Dashboard" shot={shotFor("Profit-Loss")}>
            <CompareTable
              aLabel={aShort}
              bLabel={bShort}
              rows={[
                ...A.profitParts.map((p, i) => ({
                  label: `${i > 0 ? p.op + " " : ""}${p.label}`,
                  d: delta(p.raw, B.profitParts[i]?.raw ?? 0, p.op === "+"),
                  neutral: p.label === "Fuel" || p.label.startsWith("Lottery net"),
                })),
                { label: "= Profit / Loss", d: d.profit, strong: true },
                { label: "Profit taken out", d: delta(A.profitTaken, B.profitTaken), neutral: true },
                { label: "Left after profit taken out", d: delta(A.profit - A.profitTaken, B.profit - B.profitTaken), strong: true },
              ]}
            />
          </Section>

          <Footnote />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Store name + title, shown only inside downloaded images/PDFs. */
function ExportTitle({ title, store }: { title: string; store: string }) {
  return (
    <div className="hidden [.exporting_&]:flex items-center justify-between mb-4 pb-3 border-b border-outline-variant">
      <div>
        <div className="text-headline-lg font-bold text-primary">{title}</div>
        <div className="text-body-sm text-on-surface-variant">7sCstores · {store} · generated {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
      </div>
      <div className="flex items-center gap-3 text-body-sm text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-secondary/30" /> Better than month before</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-error/30" /> Worse</span>
      </div>
    </div>
  );
}

function ProjectionNote({ report }: { report: MonthsReport }) {
  return (
    <div className="mb-4 rounded-lg border border-tertiary/30 bg-tertiary-container/30 px-4 py-3 text-body-sm text-on-tertiary-container flex gap-2">
      <Icon name="insights" className="text-[18px] mt-0.5" />
      <div>
        <span className="font-semibold">Projected columns</span> (shaded, at the end of each table):{" "}
        {report.projLabels.current && <>
          <b>{report.projLabels.current}</b> = the pace so far this month ({report.running?.done} of {report.running?.total} days) for the full month
          {report.seasonal ? ", averaged with last month adjusted by last year's change" : ""}.{" "}
        </>}
        <b>{report.projLabels.next}</b> ={" "}
        {report.seasonal
          ? "this month × how much the same months moved last year (summer/winter pattern)."
          : "this month carried forward. Once there is a full year of history, it will follow last year's seasonal pattern (e.g. soda drops in winter)."}
      </div>
    </div>
  );
}

function Footnote() {
  return (
    <p className="text-[12px] text-on-surface-variant mb-6">
      Sales, gas and lottery come from the POS sync — the same numbers as the Dashboard for the same dates. Expenses are what was entered on the
      Expenses page, grouped by payee. Short / Over = card + safe drop + EBT + other credit + cash payouts + house accounts + lottery short/over − POS sales.
      Sales colours (and the % in Compare) use the <b>daily average</b> — month total ÷ days in the month — so a 31-day month
      isn’t green and February isn’t red just because of their length; the running month compares its average so far.
      Expenses and profit compare whole months, because bills like rent and loans don’t change with the number of days.
    </p>
  );
}

function Change({ d, unit = "money" }: { d: Delta; unit?: Unit }) {
  if (d.tone === "none") return <span className="text-on-surface-variant">—</span>;
  const sign = d.diff > 0 ? "+" : d.diff < 0 ? "−" : "";
  return (
    <span className={`tabular font-semibold whitespace-nowrap ${toneText[d.tone]}`}>
      {sign}{fmtVal(Math.abs(d.diff), unit)}
      <span className="font-normal opacity-80 ml-1 text-[12px]">{d.pct === null ? "new" : `${d.pct > 0 ? "+" : ""}${d.pct.toFixed(1)}%`}</span>
    </span>
  );
}

function reconRows(a: { label: string; value: number }[], b: { label: string; value: number }[]): CompareRow[] {
  const labels = [...new Set([...a, ...b].map((x) => x.label))];
  return labels.map((label) => ({
    label,
    d: delta(a.find((x) => x.label === label)?.value ?? 0, b.find((x) => x.label === label)?.value ?? 0),
    neutral: true,
  }));
}

function ExpenseCompare({
  A, B, aLabel, bLabel,
}: {
  A: WindowFigures["expenses"];
  B: WindowFigures["expenses"];
  aLabel: string;
  bLabel: string;
}) {
  const groups = [
    { name: "Inventory", title: "Product buying (inventory purchases)", a: A.inventory, b: B.inventory },
    { name: "Operating", title: "Store expenses", a: A.operating, b: B.operating },
    { name: "Fuel", title: "Fuel purchases", a: A.fuel, b: B.fuel },
  ];
  const rows: CompareRow[] = [];
  for (const g of groups) {
    if (!g.a && !g.b) continue;
    rows.push({ label: g.title, d: delta(g.a, g.b, false), strong: true });
    const items = compareByKey(
      A.byPayee.filter((p) => p.group === g.name).map((p) => ({ key: p.key, value: p.value })),
      B.byPayee.filter((p) => p.group === g.name).map((p) => ({ key: p.key, value: p.value })),
      false
    );
    for (const it of items) rows.push({ label: it.key, d: it, indent: true });
  }
  if (!A.total && !B.total) return <EmptyState icon="receipt_long" title="No expenses entered for these months" />;
  rows.push({ label: "Total expenses", d: delta(A.total, B.total, false), strong: true });
  return <CompareTable rows={rows} aLabel={aLabel} bLabel={bLabel} firstHead="Paid to" />;
}

