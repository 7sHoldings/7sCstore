import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { todayISO } from "@/lib/day";
import { fmtMoney, fmtNumber, gradeLabel } from "@/lib/format";
import {
  compareByKey, compareWindows, defaultMonth, delta, isMonth, monthLabel, monthsEnding, shiftMonth,
  type CompareMode, type Delta, type Tone,
} from "@/lib/compare";
import { getWindowFigures, getTrend } from "@/lib/monthCompare";
import { Card, PageHeader, EmptyState, Icon, Banner } from "@/components/ui";
import { CompareKpi, CompareTable, Section, ToneLegend, toneBg, toneText, fmtVal, type CompareRow, type Unit } from "@/components/compare";
import SummaryFilter from "@/components/SummaryFilter";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function MonthlySummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; vs?: string; b?: string; full?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  if (!loc) return <Card className="p-8"><EmptyState icon="table_chart" title="No location" /></Card>;
  const sp = await searchParams;

  const today = todayISO();
  const month = isMonth(sp.month) ? sp.month : defaultMonth(today);
  const mode: CompareMode = sp.vs === "lastyear" ? "lastyear" : sp.vs === "custom" && isMonth(sp.b) ? "custom" : "prev";
  const full = sp.full === "1";
  const w = compareWindows(month, mode, sp.b, today, full);
  const running = today.slice(0, 7) === month;

  const trendMonths = monthsEnding(month, 12);
  const [A, B, trend] = await Promise.all([
    getWindowFigures(loc, w.a.start, w.a.end),
    getWindowFigures(loc, w.b.start, w.b.end),
    getTrend(loc, trendMonths),
  ]);

  const aL = w.a.label;
  const bL = w.b.label;
  const aShort = monthLabel(w.a.ym, true);
  const bShort = monthLabel(w.b.ym, true);
  const query = new URLSearchParams({ month, vs: w.mode, ...(w.mode === "custom" ? { b: w.b.ym } : {}), ...(full ? { full: "1" } : {}) }).toString();

  // ---- comparisons ----
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

  const grades = ["REGULAR", "PREMIUM", "DIESEL", ...new Set([...A.fuelGrades, ...B.fuelGrades].map((g) => g.grade))]
    .filter((g, i, arr) => arr.indexOf(g) === i)
    .map((g) => {
      const a = A.fuelGrades.find((x) => x.grade === g);
      const b = B.fuelGrades.find((x) => x.grade === g);
      return { grade: g, a, b, gal: delta(a?.gallons ?? 0, b?.gallons ?? 0), amt: delta(a?.total ?? 0, b?.total ?? 0) };
    })
    .filter((g) => g.gal.tone !== "none" || g.amt.tone !== "none");

  const deptHref = (name: string) => `/summary/dept/${encodeURIComponent(name)}?${query}`;
  const noB = !B.hasSales;
  const noA = !A.hasSales;

  return (
    <div>
      <PageHeader
        title="Monthly Summary"
        subtitle={`${aL}  vs  ${bL}`}
        actions={
          <a href="/summary/year" className="ft-btn-secondary inline-flex items-center gap-1.5">
            <Icon name="table_chart" className="text-[18px]" /> Year P&amp;L table
          </a>
        }
      />

      <Card className="p-4 mb-4">
        <SummaryFilter
          month={month}
          vs={w.mode}
          b={w.mode === "custom" ? w.b.ym : shiftMonth(month, -2)}
          full={full}
          running={running}
          prevLabel={monthLabel(shiftMonth(month, -1), true)}
          lastYearLabel={monthLabel(shiftMonth(month, -12), true)}
        />
        <div className="mt-3 pt-3 border-t border-outline-variant/40 flex flex-wrap items-center justify-between gap-2">
          <ToneLegend />
          {w.toDate && (
            <span className="text-body-sm text-on-surface-variant">
              <Icon name="info" className="text-[16px] align-[-3px] mr-1" />
              {monthLabel(month)} is still running — comparing the same {w.a.days} complete days of both months.
            </span>
          )}
        </div>
      </Card>

      {noB && (
        <Banner tone="info" icon="info">
          No sales are recorded for {monthLabel(w.b.ym)}, so every change below shows as new. Pick another month to compare with.
        </Banner>
      )}

      {noA ? (
        <Card className="p-8"><EmptyState icon="query_stats" title={`No sales recorded for ${monthLabel(month)}`} hint="Pick another month." /></Card>
      ) : (
        <>
          {/* Jump tabs */}
          <nav className="sticky top-14 lg:top-16 z-10 -mx-4 px-4 py-2 mb-4 bg-background/90 backdrop-blur border-b border-outline-variant/40 overflow-x-auto">
            <div className="flex gap-1.5 w-max">
              {[
                ["overview", "Overview"], ["departments", "Departments"], ["fuel", "Gas"], ["lottery", "Lottery"],
                ["shorts", "Short / Over"], ["expenses", "Expenses"], ["profit", "Profit"], ["trend", "Month by month"],
              ].map(([id, label]) => (
                <a key={id} href={`#${id}`} className="px-3 py-1.5 rounded-full text-body-sm font-medium bg-surface-container-lowest border border-outline-variant/60 text-on-surface hover:bg-surface-container whitespace-nowrap">
                  {label}
                </a>
              ))}
            </div>
          </nav>

          {/* Overview */}
          <div id="overview" className="scroll-mt-32 grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3 mb-4">
            <CompareKpi label="Total sales" icon="point_of_sale" d={d.total} bLabel={bShort} sub="Inside + Gas + Lottery + Tax" />
            <CompareKpi label="Inside sales" icon="shopping_bag" d={d.merch} bLabel={bShort} sub="All store departments" href="#departments" />
            <CompareKpi label="Gas sales" icon="local_gas_station" d={d.fuel} bLabel={bShort} href="#fuel" />
            <CompareKpi label="Gallons sold" icon="water_drop" d={d.gallons} unit="gal" bLabel={bShort} href="#fuel" />
            <CompareKpi label="Lottery net" icon="confirmation_number" d={d.lotto} bLabel={bShort} sub="Sales − payouts" href="#lottery" />
            <CompareKpi label="Expenses" icon="receipt_long" d={d.expenses} bLabel={bShort} sub="Lower is better" href="#expenses" />
            <CompareKpi label="Profit / Loss" icon="account_balance_wallet" d={d.profit} bLabel={bShort} sub="Same formula as the Dashboard" href="#profit" />
            <CompareKpi
              label="Short / Over"
              icon="balance"
              d={d.short}
              bLabel={bShort}
              sub={A.shortOver === null ? "Cash/card not synced yet" : A.shortOver < 0 ? "Short — money missing" : "Over / balanced"}
              href="#shorts"
            />
          </div>

          {(gainers.length > 0 || losers.length > 0) && (
            <Card className="p-4 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Movers title={`Departments up vs ${bShort}`} icon="trending_up" tone="good" rows={gainers} href={deptHref} />
                <Movers title={`Departments down vs ${bShort}`} icon="trending_down" tone="bad" rows={losers} href={deptHref} />
              </div>
            </Card>
          )}

          {/* Departments */}
          <Section id="departments" title="Departments" icon="category" note="Tap a department to see its products">
            <DeptCompare rows={depts} aLabel={aShort} bLabel={bShort} total={d.merch} href={deptHref} />
          </Section>

          {/* Fuel */}
          <Section id="fuel" title="Gas — gallons & sales by grade" icon="local_gas_station" note={`${fmtVal(A.gallons, "gal")} in ${aShort}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="text-left text-label-caps uppercase text-on-surface-variant border-b border-outline-variant/50">
                    <th className="px-5 py-2.5">Grade</th>
                    <th className="px-3 py-2.5 text-right">Gallons {aShort}</th>
                    <th className="px-3 py-2.5 text-right">Gallons {bShort}</th>
                    <th className="px-3 py-2.5 text-right">Change</th>
                    <th className="px-3 py-2.5 text-right">Sales {aShort}</th>
                    <th className="px-3 py-2.5 text-right">Sales {bShort}</th>
                    <th className="px-3 py-2.5 text-right">Change</th>
                    <th className="px-5 py-2.5 text-right">$/gal {aShort} · {bShort}</th>
                  </tr>
                </thead>
                <tbody>
                  {grades.map((g) => (
                    <tr key={g.grade} className={`border-b border-outline-variant/30 ${toneBg[g.gal.tone]}`}>
                      <td className="px-5 py-2.5 font-semibold text-on-surface">{gradeLabel(g.grade)}</td>
                      <td className="px-3 py-2.5 text-right tabular">{fmtVal(g.gal.a, "gal")}</td>
                      <td className="px-3 py-2.5 text-right tabular text-on-surface-variant">{fmtVal(g.gal.b, "gal")}</td>
                      <td className="px-3 py-2.5 text-right"><Change d={g.gal} unit="gal" /></td>
                      <td className="px-3 py-2.5 text-right tabular">{fmtMoney(g.amt.a)}</td>
                      <td className="px-3 py-2.5 text-right tabular text-on-surface-variant">{fmtMoney(g.amt.b)}</td>
                      <td className="px-3 py-2.5 text-right"><Change d={g.amt} /></td>
                      <td className="px-5 py-2.5 text-right tabular text-on-surface-variant whitespace-nowrap">
                        {g.a?.price ? `$${g.a.price.toFixed(3)}` : "—"} · {g.b?.price ? `$${g.b.price.toFixed(3)}` : "—"}
                      </td>
                    </tr>
                  ))}
                  <tr className={`font-semibold ${toneBg[d.gallons.tone]}`}>
                    <td className="px-5 py-2.5">All grades</td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtVal(d.gallons.a, "gal")}</td>
                    <td className="px-3 py-2.5 text-right tabular text-on-surface-variant">{fmtVal(d.gallons.b, "gal")}</td>
                    <td className="px-3 py-2.5 text-right"><Change d={d.gallons} unit="gal" /></td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtMoney(d.fuel.a)}</td>
                    <td className="px-3 py-2.5 text-right tabular text-on-surface-variant">{fmtMoney(d.fuel.b)}</td>
                    <td className="px-3 py-2.5 text-right"><Change d={d.fuel} /></td>
                    <td className="px-5 py-2.5" />
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-[12px] text-on-surface-variant border-t border-outline-variant/40">Mid-grade is blended 50/50 from the Regular and Premium tanks, so it is split into those two.</p>
          </Section>

          {/* Lottery */}
          <Section id="lottery" title="Lottery / Lotto" icon="confirmation_number">
            <CompareTable
              aLabel={aShort}
              bLabel={bShort}
              rows={[
                { label: "Lottery sales", d: delta(A.lotto.sales, B.lotto.sales) },
                { label: "Payouts (winners paid)", d: delta(A.lotto.payout, B.lotto.payout), neutral: true },
                { label: "Lottery net (POS)", d: delta(A.lotto.net, B.lotto.net), strong: true },
                ...(A.lotto.manual || B.lotto.manual
                  ? [
                      { label: "Lottery net (entered by staff)", d: delta(A.lotto.manual?.net ?? 0, B.lotto.manual?.net ?? 0), neutral: true },
                      { label: "Lottery short / over", d: delta(A.lotto.over, B.lotto.over), strong: true },
                    ]
                  : []),
              ]}
            />
          </Section>

          {/* Shorts */}
          <Section
            id="shorts"
            title="Short / Over — cash reconciliation"
            icon="balance"
            note={A.shortOver === null ? "Cash/card totals not synced for this month" : "Money collected minus POS sales"}
          >
            {A.recon.length || B.recon.length ? (
              <CompareTable
                aLabel={aShort}
                bLabel={bShort}
                rows={[
                  ...reconRows(A.recon, B.recon),
                  { label: "Short / Over", d: d.short, strong: true },
                ]}
              />
            ) : (
              <EmptyState icon="balance" title="No cash/card totals for these months" hint="Short/over appears once the safe drop and card batch are synced." />
            )}
          </Section>

          {/* Expenses */}
          <Section id="expenses" title="Expenses — where the money went" icon="receipt_long" note="Spending more shows red">
            <ExpenseCompare A={A.expenses} B={B.expenses} aLabel={aShort} bLabel={bShort} />
          </Section>

          {/* Profit */}
          <Section id="profit" title="Profit / Loss" icon="account_balance_wallet" note="Same formula as the Dashboard card">
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

          {/* Month by month */}
          <Section id="trend" title="Month by month" icon="calendar_month" note="Each month is coloured against the month before it">
            <TrendGrid trend={trend} running={running ? month : null} href={deptHref} />
          </Section>

          <p className="text-[12px] text-on-surface-variant mb-6">
            Sales, gas and lottery come from the POS sync — the same numbers as the Dashboard for the same dates. Expenses are what was entered on the
            Expenses page, grouped by payee. Short / Over = card + safe drop + EBT + other credit + cash payouts + house accounts + lottery short/over − POS sales.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

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
              <a href={href(r.key)} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 ${toneBg[tone]} hover:opacity-90`}>
                <span className="font-medium text-on-surface truncate">{r.key}</span>
                <Change d={r} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeptCompare({
  rows, aLabel, bLabel, total, href,
}: {
  rows: (Delta & { key: string })[]; aLabel: string; bLabel: string; total: Delta; href: (n: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.a, r.b)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="text-left text-label-caps uppercase text-on-surface-variant border-b border-outline-variant/50">
            <th className="px-5 py-2.5">Department</th>
            <th className="px-3 py-2.5 text-right">{aLabel}</th>
            <th className="px-3 py-2.5 text-right">{bLabel}</th>
            <th className="px-3 py-2.5 text-right">Change</th>
            <th className="px-3 py-2.5 text-right">Share</th>
            <th className="px-5 py-2.5 hidden md:table-cell w-48" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`border-b border-outline-variant/30 ${toneBg[r.tone]}`}>
              <td className="px-5 py-2.5">
                <a href={href(r.key)} className="font-semibold text-primary hover:underline inline-flex items-center gap-1">
                  {r.key} <Icon name="chevron_right" className="text-[16px] opacity-60" />
                </a>
              </td>
              <td className="px-3 py-2.5 text-right tabular font-medium">{fmtMoney(r.a)}</td>
              <td className="px-3 py-2.5 text-right tabular text-on-surface-variant">{fmtMoney(r.b)}</td>
              <td className="px-3 py-2.5 text-right"><Change d={r} /></td>
              <td className="px-3 py-2.5 text-right tabular text-on-surface-variant">{total.a ? `${((r.a / total.a) * 100).toFixed(1)}%` : "—"}</td>
              <td className="px-5 py-2.5 hidden md:table-cell">
                <div className="space-y-1">
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(Math.max(0, r.a) / max) * 100}%` }} />
                  <div className="h-1.5 rounded-full bg-outline-variant" style={{ width: `${(Math.max(0, r.b) / max) * 100}%` }} />
                </div>
              </td>
            </tr>
          ))}
          <tr className={`font-semibold ${toneBg[total.tone]}`}>
            <td className="px-5 py-3">All inside sales</td>
            <td className="px-3 py-3 text-right tabular">{fmtMoney(total.a)}</td>
            <td className="px-3 py-3 text-right tabular text-on-surface-variant">{fmtMoney(total.b)}</td>
            <td className="px-3 py-3 text-right"><Change d={total} /></td>
            <td className="px-3 py-3 text-right tabular">100%</td>
            <td className="hidden md:table-cell" />
          </tr>
        </tbody>
      </table>
      <div className="px-5 py-2 text-[12px] text-on-surface-variant border-t border-outline-variant/40 hidden md:flex items-center gap-4">
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-1.5 rounded-full bg-primary" /> {aLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-1.5 rounded-full bg-outline-variant" /> {bLabel}</span>
      </div>
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
  A: { total: number; inventory: number; operating: number; fuel: number; byPayee: { key: string; group: string; value: number }[] };
  B: { total: number; inventory: number; operating: number; fuel: number; byPayee: { key: string; group: string; value: number }[] };
  aLabel: string;
  bLabel: string;
}) {
  const groups: { name: string; title: string; a: number; b: number }[] = [
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
  rows.push({ label: "Total expenses", d: delta(A.total, B.total, false), strong: true });
  if (rows.length === 1 && !A.total && !B.total) {
    return <EmptyState icon="receipt_long" title="No expenses entered for these months" />;
  }
  return <CompareTable rows={rows} aLabel={aLabel} bLabel={bLabel} firstHead="Paid to" />;
}

function TrendGrid({
  trend, running, href,
}: {
  trend: Awaited<ReturnType<typeof getTrend>>; running: string | null; href: (n: string) => string;
}) {
  const months = trend.filter((t, i) => t.posSales !== 0 || trend.slice(i).some((x) => x.posSales !== 0));
  const firstWithData = months.findIndex((t) => t.posSales !== 0);
  const shown = firstWithData < 0 ? [] : months.slice(firstWithData);
  if (!shown.length) return <EmptyState icon="calendar_month" title="No monthly history yet" />;

  const deptTotals = new Map<string, number>();
  for (const t of shown) for (const [k, v] of t.depts) deptTotals.set(k, (deptTotals.get(k) ?? 0) + v);
  const deptNames = [...deptTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const lines: { label: string; get: (t: (typeof shown)[number]) => number; unit?: Unit; good?: boolean; dept?: boolean }[] = [
    { label: "Total sales", get: (t) => t.posSales },
    { label: "Inside sales", get: (t) => t.merch },
    { label: "Gas sales", get: (t) => t.fuel },
    { label: "Gallons", get: (t) => t.gallons, unit: "gal" },
    { label: "Lottery net", get: (t) => t.lottoNet },
    { label: "Expenses", get: (t) => t.expenses, good: false },
    ...deptNames.map((n) => ({ label: n, get: (t: (typeof shown)[number]) => t.depts.get(n) ?? 0, dept: true })),
  ];

  const compact = (v: number, unit?: Unit) =>
    unit === "gal" ? fmtNumber(Math.round(v)) : Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;

  return (
    <div className="overflow-x-auto">
      <table className="text-body-sm min-w-full">
        <thead>
          <tr className="text-label-caps uppercase text-on-surface-variant border-b border-outline-variant/50">
            <th className="sticky left-0 z-[1] bg-surface-container-lowest px-5 py-2.5 text-left min-w-[150px]" />
            {shown.map((t) => (
              <th key={t.ym} className="px-2.5 py-2.5 text-right whitespace-nowrap">
                {monthLabel(t.ym, true).replace(" 20", " ’")}
                {t.ym === running && <div className="normal-case font-normal text-[11px]">to date</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, li) => (
            <tr key={line.label} className={`border-b border-outline-variant/30 ${li === 6 ? "border-t-2 border-t-outline-variant/60" : ""}`}>
              <td className={`sticky left-0 z-[1] bg-surface-container-lowest px-5 py-2 whitespace-nowrap ${line.dept ? "" : "font-semibold"}`}>
                {line.dept ? <a href={href(line.label)} className="text-primary hover:underline">{line.label}</a> : line.label}
              </td>
              {shown.map((t, i) => {
                const v = line.get(t);
                const prev = i > 0 ? line.get(shown[i - 1]) : null;
                const tone: Tone = prev === null || t.ym === running ? "none" : delta(v, prev, line.good !== false).tone;
                return (
                  <td key={t.ym} className={`px-2.5 py-2 text-right tabular whitespace-nowrap ${toneBg[tone]} ${tone === "good" || tone === "bad" ? toneText[tone] : "text-on-surface"}`}
                    title={prev !== null ? `${fmtVal(v, line.unit)} (was ${fmtVal(prev, line.unit)})` : fmtVal(v, line.unit)}>
                    {v ? compact(v, line.unit) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {li6Note}
    </div>
  );
}

const li6Note = (
  <p className="px-5 py-2.5 text-[12px] text-on-surface-variant border-t border-outline-variant/40">
    Rows below the line are departments — tap one to open its products. The running month isn’t coloured because it isn’t finished yet.
  </p>
);
