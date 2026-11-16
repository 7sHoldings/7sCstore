import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { todayISO } from "@/lib/day";
import { gradeLabel } from "@/lib/format";
import {
  compareByKey, compareWindows, defaultMonth, delta, isMonth, monthLabel, shiftMonth,
  type CompareMode, type Delta, type Tone,
} from "@/lib/compare";
import { getWindowFigures, type WindowFigures } from "@/lib/monthCompare";
import { buildMonthsReport, type MonthsReport } from "@/lib/monthsReport";
import { Card, PageHeader, EmptyState, Icon, Banner } from "@/components/ui";
import {
  CompareKpi, CompareTable, MonthGrid, Num, Section, ToneLegend, toneText, fmtVal,
  type CompareRow, type Unit,
} from "@/components/compare";
import SummaryFilter from "@/components/SummaryFilter";
import SummaryExport from "@/components/SummaryExport";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const GRADES = ["REGULAR", "PREMIUM", "DIESEL"];

export default async function MonthlySummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; vs?: string; b?: string; full?: string; view?: string }>;
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
  const yearLabel = month.endsWith("-01") ? `Jan ${year}` : `Jan – ${monthLabel(month, true)}`;

  const query = new URLSearchParams({
    month, vs: w.mode,
    ...(w.mode === "custom" ? { b: w.b.ym } : {}),
    ...(full ? { full: "1" } : {}),
    ...(view === "compare" ? { view: "compare" } : {}),
  }).toString();
  const deptHref = (name: string) => `/summary/dept/${encodeURIComponent(name)}?${query}`;

  const filter = (
    <Card className="p-4 mb-4">
      <SummaryFilter
        month={month}
        vs={w.mode}
        b={w.mode === "custom" ? w.b.ym : shiftMonth(month, -2)}
        full={full}
        running={running}
        prevLabel={monthLabel(shiftMonth(month, -1), true)}
        lastYearLabel={monthLabel(shiftMonth(month, -12), true)}
        view={view}
        yearLabel={yearLabel}
      />
      <div className="mt-3 pt-3 border-t border-outline-variant/40 flex flex-wrap items-center justify-between gap-2">
        <ToneLegend />
        {view === "compare" && w.toDate && (
          <span className="text-body-sm text-on-surface-variant">
            <Icon name="info" className="text-[16px] align-[-3px] mr-1" />
            {monthLabel(month)} is still running — comparing the same {w.a.days} complete days of both months.
          </span>
        )}
      </div>
    </Card>
  );

  const header = (
    <PageHeader
      title="Monthly Summary"
      subtitle={view === "months" ? `Every month of ${year}, January to ${monthLabel(month)}` : `${w.a.label}  vs  ${w.b.label}`}
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
          ["shorts", "Short / Over"], ["expenses", "Expenses"], ["profit", "Profit"],
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
    const report = await buildMonthsReport(loc, month, today);
    if (!report.hasData) {
      return (
        <div>
          {header}
          {filter}
          <Card className="p-8"><EmptyState icon="query_stats" title={`No sales recorded in ${year}`} hint="Pick another month." /></Card>
        </div>
      );
    }
    return (
      <div>
        {header}
        {filter}
        {jumpTabs}
        <SummaryExport targetId="summary-export" fileName={`Monthly-Summary-${month}`} excelHref={`/api/summary/export?month=${month}`} />

        <div id="summary-export">
          <ExportTitle title={`Monthly Summary — ${yearLabel}`} store={storeName} />
          <ProjectionNote report={report} />
          {report.sections.map((s) => (
            <Section key={s.id} id={s.id} title={s.title} icon={s.icon} note={s.note || undefined}>
              {s.empty ? (
                <EmptyState icon={s.icon} title={s.empty} />
              ) : (
                <MonthGrid
                  months={report.months}
                  projLabels={report.projLabels}
                  rows={s.rows.map((r) => ({
                    ...r,
                    label: r.dept ? <a href={deptHref(r.dept)} className="text-primary font-medium hover:underline">{r.label}</a> : r.label,
                  }))}
                />
              )}
            </Section>
          ))}
          <Footnote />
        </div>
      </div>
    );
  }

  // =========================================================================
  // COMPARE 2 MONTHS view
  // =========================================================================
  const [A, B] = await Promise.all([getWindowFigures(loc, w.a.start, w.a.end), getWindowFigures(loc, w.b.start, w.b.end)]);
  const aShort = monthLabel(w.a.ym, true);
  const bShort = monthLabel(w.b.ym, true);

  const d = {
    total: delta(A.posSales, B.posSales),
    merch: delta(A.merch, B.merch),
    fuel: delta(A.fuel, B.fuel),
    gallons: delta(A.gallons, B.gallons),
    lotto: delta(A.lottoNet, B.lottoNet),
    expenses: delta(A.expenses.total, B.expenses.total, false),
    profit: delta(A.profit, B.profit),
    short: delta(A.shortOver ?? 0, B.shortOver ?? 0),
  };
  const depts = compareByKey(
    A.depts.map((x) => ({ key: x.name, value: x.sales })),
    B.depts.map((x) => ({ key: x.name, value: x.sales }))
  );
  const gainers = depts.filter((x) => x.tone === "good").sort((x, y) => y.diff - x.diff).slice(0, 3);
  const losers = depts.filter((x) => x.tone === "bad").sort((x, y) => x.diff - y.diff).slice(0, 3);
  const gradeOf = (f: WindowFigures, g: string) => f.fuelGrades.find((x) => x.grade === g);
  const gradeRows = GRADES.map((g) => ({ g, a: gradeOf(A, g), b: gradeOf(B, g) })).filter((x) => x.a || x.b);

  return (
    <div>
      {header}
      {filter}

      {!B.hasSales && (
        <Banner tone="info" icon="info">
          No sales are recorded for {monthLabel(w.b.ym)}, so every change below shows as new. Pick another month to compare with.
        </Banner>
      )}

      {!A.hasSales ? (
        <Card className="p-8"><EmptyState icon="query_stats" title={`No sales recorded for ${monthLabel(month)}`} hint="Pick another month." /></Card>
      ) : (
        <>
          {jumpTabs}
          <SummaryExport targetId="summary-export" fileName={`Monthly-Summary-${w.a.ym}-vs-${w.b.ym}`} excelHref={`/api/summary/export?month=${month}`} />
          <div id="summary-export">
          <ExportTitle title={`Monthly Summary — ${w.a.label} vs ${w.b.label}`} store={storeName} />

          <div id="overview" className="scroll-mt-32 grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3 mb-4">
            <CompareKpi label="Total sales" icon="point_of_sale" d={d.total} bLabel={bShort} sub="Inside + Gas + Lottery + Tax" />
            <CompareKpi label="Inside sales" icon="shopping_bag" d={d.merch} bLabel={bShort} href="#departments" />
            <CompareKpi label="Gas sales" icon="local_gas_station" d={d.fuel} bLabel={bShort} href="#fuel" />
            <CompareKpi label="Gallons sold" icon="water_drop" d={d.gallons} unit="gal" bLabel={bShort} href="#fuel" />
            <CompareKpi label="Lottery net" icon="confirmation_number" d={d.lotto} bLabel={bShort} href="#lottery" />
            <CompareKpi label="Expenses" icon="receipt_long" d={d.expenses} bLabel={bShort} sub="Lower is better" href="#expenses" />
            <CompareKpi label="Profit / Loss" icon="account_balance_wallet" d={d.profit} bLabel={bShort} href="#profit" />
            <CompareKpi label="Short / Over" icon="balance" d={d.short} bLabel={bShort} href="#shorts" />
          </div>

          {(gainers.length > 0 || losers.length > 0) && (
            <Card className="p-4 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Movers title={`Departments up vs ${bShort}`} icon="trending_up" tone="good" rows={gainers} href={deptHref} />
                <Movers title={`Departments down vs ${bShort}`} icon="trending_down" tone="bad" rows={losers} href={deptHref} />
              </div>
            </Card>
          )}

          <Section id="departments" title="Departments" icon="category" note="Tap a department to see its products">
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

          <Section id="fuel" title="Gas — gallons & sales by grade" icon="local_gas_station" note="Mid-grade is split 50/50 into Regular and Premium">
            <CompareTable
              aLabel={aShort}
              bLabel={bShort}
              firstHead="Gallons"
              rows={[
                ...gradeRows.map((x): CompareRow => ({ label: gradeLabel(x.g), d: delta(x.a?.gallons ?? 0, x.b?.gallons ?? 0), unit: "gal" })),
                { label: "All grades", d: d.gallons, unit: "gal", strong: true },
              ]}
            />
            <div className="border-t border-outline-variant/50" />
            <CompareTable
              aLabel={aShort}
              bLabel={bShort}
              firstHead="Gas sales"
              rows={[
                ...gradeRows.map((x): CompareRow => ({ label: gradeLabel(x.g), d: delta(x.a?.total ?? 0, x.b?.total ?? 0) })),
                { label: "All grades", d: d.fuel, strong: true },
              ]}
            />
          </Section>

          <Section id="lottery" title="Lottery / Lotto" icon="confirmation_number">
            <CompareTable
              aLabel={aShort}
              bLabel={bShort}
              rows={[
                { label: "Lottery sales", d: delta(A.lotto.sales, B.lotto.sales) },
                { label: "Payouts (winners)", d: delta(A.lotto.payout, B.lotto.payout), neutral: true },
                { label: "Lottery net (POS)", d: delta(A.lotto.net, B.lotto.net), strong: true },
                { label: "Net entered by staff", d: delta(A.lotto.manual?.net ?? 0, B.lotto.manual?.net ?? 0), neutral: true },
                { label: "Lottery short / over", d: delta(A.lotto.over, B.lotto.over), strong: true },
              ]}
            />
          </Section>

          <Section id="shorts" title="Short / Over — cash reconciliation" icon="balance" note="Money collected minus POS sales">
            {A.recon.length || B.recon.length ? (
              <CompareTable aLabel={aShort} bLabel={bShort} rows={[...reconRows(A.recon, B.recon), { label: "Short / Over", d: d.short, strong: true }]} />
            ) : (
              <EmptyState icon="balance" title="No cash/card totals for these months" />
            )}
          </Section>

          <Section id="expenses" title="Expenses — where the money went" icon="receipt_long" note="Spending more shows red">
            <ExpenseCompare A={A.expenses} B={B.expenses} aLabel={aShort} bLabel={bShort} />
          </Section>

          <Section id="profit" title="Profit / Loss" icon="account_balance_wallet" note="Same formula as the Dashboard">
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
      The running month is shown up to today and isn’t coloured, because it isn’t finished yet.
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

function Movers({
  title, icon, tone, rows, href,
}: {
  title: string; icon: string; tone: Tone; rows: (Delta & { key: string })[]; href: (n: string) => string;
}) {
  return (
    <div>
      <div className={`flex items-center gap-1.5 text-label-caps uppercase mb-2 ${toneText[tone]}`}>
        <Icon name={icon} className="text-[18px]" /> {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">None</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.key}>
              <a href={href(r.key)} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 border border-outline-variant/50 hover:bg-surface-container">
                <span className="font-medium text-on-surface truncate">{r.key}</span>
                <span className="flex items-center gap-2">
                  <Num v={r.a} tone={r.tone} />
                  <Change d={r} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
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
    { name: "Inventory", title: "Inventory purchases (vendors)", a: A.inventory, b: B.inventory },
    { name: "Operating", title: "Operating expenses", a: A.operating, b: B.operating },
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

