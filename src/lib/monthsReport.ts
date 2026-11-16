import "server-only";
import { gradeLabel } from "./format";
import { daysInMonth, monthLabel, monthStart, shiftMonth, type Unit } from "./compare";
import { getWindowFigures, type WindowFigures } from "./monthCompare";
import { project } from "./projection";

/**
 * The "All months" Monthly Summary as plain data — January to the selected
 * month for every section, with projections. The page renders it and the
 * Excel export writes it, so both always show the same numbers.
 */
export interface ReportRow {
  label: string;
  values: number[];
  unit?: Unit;
  good?: boolean; // default true: higher is better
  neutral?: boolean;
  strong?: boolean;
  indent?: boolean;
  section?: string;
  dept?: string; // links to the department page
  noTotal?: boolean;
  threshold?: number; // colour against a fixed target (e.g. gross profit ≥ 30%)
  groupHead?: string; // tap to open the rows of this group (e.g. payees)
  pctBase?: number[];
  perDay?: boolean; // green/red on the daily average (sales-type rows) // per month: show "(x%)" of this next to each number (share of total expenses)
  group?: string; // hidden until its group is opened
  totalValue?: number | null; // total column override (e.g. whole-period %)
  proj?: { current: number | null; next: number | null } | null;
}
export interface ReportSection {
  id: string;
  title: string;
  icon: string;
  note: string;
  rows: ReportRow[];
  empty?: string; // message when there is nothing to show
}
export interface MonthsReport {
  year: string;
  month: string;
  months: { ym: string; label: string; partial: boolean; days: number }[];
  running: { done: number; total: number } | null;
  projLabels: { current: string | null; next: string };
  seasonal: boolean; // last-year data was available for projections
  hasData: boolean;
  sections: ReportSection[];
}

const GRADES = ["REGULAR", "PREMIUM", "DIESEL"];

type Get = (f: WindowFigures) => number;
interface Spec extends Omit<ReportRow, "values" | "proj"> {
  get: Get;
  project?: boolean;
  shareOfExpenses?: boolean; // show each number's share of total expenses in brackets
}

/** Months from `from` to `to`, oldest first (at most 24). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let ym = from > to ? to : from;
  while (ym <= to && out.length < 24) {
    out.push(ym);
    ym = shiftMonth(ym, 1);
  }
  return out.length ? out : [to];
}

export async function buildMonthsReport(loc: string, from: string, month: string, today: string): Promise<MonthsReport> {
  const year = month.slice(0, 4);
  const running = today.slice(0, 7) === month;
  const done = running ? Math.max(1, Number(today.slice(8, 10)) - 1) : daysInMonth(month);
  const yms = monthRange(from < shiftMonth(month, -23) ? shiftMonth(month, -23) : from, month);
  const multiYear = yms[0].slice(0, 4) !== month.slice(0, 4);

  const window = (ym: string) => {
    const start = monthStart(ym);
    // Running month: through today, exactly like the Dashboard's "This month" (anything
    // entered for today — expenses, safe drop, lottery — counts). Sales usually
    // arrive a day later, so projections use the completed days (`done`).
    const end = running && ym === month ? new Date(start.getTime() + Number(today.slice(8, 10)) * 86400000) : monthStart(shiftMonth(ym, 1));
    return getWindowFigures(loc, start, end);
  };
  const full = (ym: string) => getWindowFigures(loc, monthStart(ym), monthStart(shiftMonth(ym, 1)));

  // Last year's previous / same / next month — the seasonal shape for projections.
  const [figs, lyPrev, lyCur, lyNext] = await Promise.all([
    Promise.all(yms.map(window)),
    full(shiftMonth(month, -13)),
    full(shiftMonth(month, -12)),
    full(shiftMonth(month, -11)),
  ]);
  const seasonal = lyCur.hasSales && lyPrev.hasSales && lyNext.hasSales;
  const runningInfo = running ? { done, total: daysInMonth(month) } : null;

  const build = (specs: Spec[]): ReportRow[] =>
    specs.map(({ get, project: doProject, shareOfExpenses, ...rest }) => {
      const values = figs.map(get);
      return {
        // Sales-type rows (projected, higher-is-better, not %) compare the daily
        // average so month length doesn't decide the colour. Bills don't.
        perDay: !!doProject && rest.good !== false && rest.unit !== "pct",
        ...rest,
        values,
        ...(shareOfExpenses ? { pctBase: figs.map((f) => f.expenses.total) } : {}),
        proj: doProject
          ? project({
              values,
              running: runningInfo,
              lastYear: seasonal ? { prev: get(lyPrev), cur: get(lyCur), next: get(lyNext) } : null,
            })
          : null,
      };
    });

  // ---- gross profit, exactly like the Dashboard banner: inside sales − product buying ----
  const merchTotal = figs.reduce((a, f) => a + f.merch, 0);
  const invTotal = figs.reduce((a, f) => a + f.expenses.inventory, 0);
  const gpPctTotal = merchTotal > 0 ? Math.round(((merchTotal - invTotal) / merchTotal) * 1000) / 10 : null;
  const gpSpecs = (section: string): Spec[] => [
    {
      section,
      label: "Product buying % (≤ 70%)",
      get: (f) => (f.merch > 0 ? Math.round((f.expenses.inventory / f.merch) * 1000) / 10 : 0),
      unit: "pct",
      threshold: 70,
      good: false,
      totalValue: gpPctTotal === null ? null : Math.round((100 - gpPctTotal) * 10) / 10,
    },
    { label: "Gross profit", get: (f) => f.grossProfit, project: true },
    { label: "Gross profit % (≥ 30%)", get: (f) => f.grossProfitPct ?? 0, unit: "pct", threshold: 30, strong: true, totalValue: gpPctTotal },
  ];

  // ---- departments, biggest first by year total ----
  const deptTotals = new Map<string, number>();
  for (const f of figs) for (const d of f.depts) deptTotals.set(d.name, (deptTotals.get(d.name) ?? 0) + d.sales);
  const deptNames = [...deptTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const deptGet = (n: string): Get => (f) => f.depts.find((d) => d.name === n)?.sales ?? 0;

  const gradeGet = (g: string, k: "gallons" | "total"): Get => (f) => f.fuelGrades.find((x) => x.grade === g)?.[k] ?? 0;
  const grades = GRADES.filter((g) => figs.some((f) => f.fuelGrades.some((x) => x.grade === g)));

  // ---- expenses: group subtotal (opens to its payees), each with its share of all expenses ----
  const expenseGroupSpecs = (): Spec[] => {
    const out: Spec[] = [];
    for (const [group, title] of [["Inventory", "Product buying"], ["Operating", "Store expenses"], ["Fuel", "Fuel purchases"]] as const) {
      const sub: Get = (f) => (group === "Inventory" ? f.expenses.inventory : group === "Operating" ? f.expenses.operating : f.expenses.fuel);
      if (!figs.some((f) => sub(f))) continue;
      out.push({ label: title, get: sub, good: false, strong: true, project: true, groupHead: group, shareOfExpenses: true });
      const payees = new Map<string, number>();
      for (const f of figs) for (const p of f.expenses.byPayee) if (p.group === group) payees.set(p.key, (payees.get(p.key) ?? 0) + p.value);
      for (const [name] of [...payees.entries()].sort((a, b) => b[1] - a[1])) {
        out.push({
          label: name,
          get: (f) => f.expenses.byPayee.filter((p) => p.group === group && p.key === name).reduce((s, p) => s + p.value, 0),
          good: false,
          indent: true,
          group,
          shareOfExpenses: true,
        });
      }
    }
    return out;
  };
  const expenseSpecs: Spec[] = expenseGroupSpecs();
  expenseSpecs.push({ label: "Total expenses", get: (f) => f.expenses.total, good: false, strong: true, project: true });
  expenseSpecs.push(...gpSpecs("Percent of inside sales"));

  const reconLabels = [...new Set(figs.flatMap((f) => f.recon.map((r) => r.label)))];
  const profitParts = figs[0]?.profitParts ?? [];

  const sections: ReportSection[] = [
    {
      id: "overview",
      title: "Store totals by month",
      icon: "storefront",
      note: "Each number compared with the month before",
      rows: build([
        { label: "Total sales", get: (f) => f.posSales, strong: true, project: true },
        { label: "Inside sales", get: (f) => f.merch, project: true },
        { label: "Gas sales", get: (f) => f.fuel, project: true },
        { label: "Gallons sold", get: (f) => f.gallons, unit: "gal", project: true },
        { label: "Lottery net", get: (f) => f.lottoNet, project: true },
        { label: "Expenses", get: (f) => f.expenses.total, good: false, project: true },
        { label: "Profit / Loss", get: (f) => f.profit, strong: true },
        { label: "Gross profit % (≥ 30%)", get: (f) => f.grossProfitPct ?? 0, unit: "pct", threshold: 30, totalValue: gpPctTotal },
        { label: "Profit taken out", get: (f) => f.profitTaken, neutral: true },
        { label: "Short / Over", get: (f) => f.shortOver ?? 0 },
      ]),
    },
    {
      id: "departments",
      title: "Departments",
      icon: "category",
      note: "Tap a department to see its brands and products",
      rows: build([
        ...deptNames.map((n): Spec => ({ label: n, dept: n, get: deptGet(n), project: true })),
        { label: "All inside sales", get: (f) => f.merch, strong: true, project: true },
      ]),
    },
    {
      id: "fuel",
      title: "Gas — gallons & sales by grade",
      icon: "local_gas_station",
      note: "Mid-grade is split 50/50 into Regular and Premium",
      rows: build([
        ...grades.map((g, i): Spec => ({ section: i === 0 ? "Gallons sold" : undefined, label: gradeLabel(g), get: gradeGet(g, "gallons"), unit: "gal", project: true })),
        { label: "All grades (gallons)", get: (f) => f.gallons, unit: "gal", strong: true, project: true },
        ...grades.map((g, i): Spec => ({ section: i === 0 ? "Gas sales ($)" : undefined, label: gradeLabel(g), get: gradeGet(g, "total"), project: true })),
        { label: "All grades ($)", get: (f) => f.fuel, strong: true, project: true },
      ]),
    },
    {
      id: "lottery",
      title: "Lottery / Lotto",
      icon: "confirmation_number",
      note: "",
      rows: build([
        { label: "Lottery sales", get: (f) => f.lotto.sales, project: true },
        { label: "Payouts (winners)", get: (f) => f.lotto.payout, neutral: true, project: true },
        { label: "Lottery net (POS)", get: (f) => f.lotto.net, strong: true, project: true },
        { label: "Net entered by staff", get: (f) => f.lotto.manual?.net ?? 0, neutral: true },
        { label: "Lottery short / over", get: (f) => f.lotto.over, strong: true },
      ]),
    },
    {
      id: "shorts",
      title: "Short / Over — cash reconciliation",
      icon: "balance",
      note: "Money collected minus POS sales",
      empty: reconLabels.length ? undefined : "No cash/card totals synced yet",
      rows: reconLabels.length
        ? build([
            ...reconLabels.map((l): Spec => ({ label: l, get: (f) => f.recon.find((r) => r.label === l)?.value ?? 0, neutral: true })),
            { label: "Short / Over", get: (f) => f.shortOver ?? 0, strong: true },
          ])
        : [],
    },
    {
      id: "expenses",
      title: "Expenses — where the money went",
      icon: "receipt_long",
      note: "Red = spent more than the month before · small % = share of all expenses",
      rows: build(expenseSpecs),
    },
    {
      id: "profit",
      title: "Profit / Loss",
      icon: "account_balance_wallet",
      note: "Same formula as the Dashboard",
      rows: build([
        ...profitParts.map((p, i): Spec => ({
          label: `${i > 0 ? p.op + " " : ""}${p.label}`,
          get: (f) => f.profitParts[i]?.raw ?? 0,
          good: p.op === "+",
          neutral: p.label === "Fuel" || p.label.startsWith("Lottery net"),
        })),
        { label: "= Profit / Loss", get: (f) => f.profit, strong: true },
        { label: "Profit taken out", get: (f) => f.profitTaken, neutral: true },
        { label: "Left after taken out", get: (f) => f.profit - f.profitTaken, strong: true },
      ]),
    },
    {
      id: "profitout",
      title: "Profit taken out",
      icon: "savings",
      note: "From the Profit Taken Out page",
      rows: [
        ...build([
          { label: "Profit / Loss", get: (f) => f.profit },
          { label: "Profit taken out", get: (f) => f.profitTaken, neutral: true, strong: true },
          { label: "Left after taken out", get: (f) => f.profit - f.profitTaken, strong: true },
        ]),
        {
          label: "Left — running total",
          values: figs.reduce<number[]>((acc, f) => [...acc, (acc[acc.length - 1] ?? 0) + f.profit - f.profitTaken], []),
          neutral: true,
          noTotal: true,
        },
      ],
    },
    {
      // One table with the whole store — departments down to the profit/loss
      // line — so a single screenshot tells the full story.
      id: "master",
      title: "Whole store summary",
      icon: "summarize",
      note: "Departments → sales → cash → profit, in one table",
      rows: build([
        ...deptNames.map((n, i): Spec => ({ section: i === 0 ? "Departments" : undefined, label: n, dept: n, get: deptGet(n), project: true })),
        { section: "Sales", label: "Inside sales", get: (f) => f.merch, strong: true, project: true },
        { label: "Gas sales", get: (f) => f.fuel, project: true },
        { label: "Gallons sold", get: (f) => f.gallons, unit: "gal", project: true },
        { label: "Lottery net", get: (f) => f.lottoNet, project: true },
        { label: "Sales tax (from expenses)", get: (f) => f.salesTaxPaid, neutral: true },
        { label: "Total sales", get: (f) => f.posSales, strong: true, project: true },
        { section: "Money collected", label: "Cash (safe drop)", get: (f) => f.tender?.cash ?? 0, project: true },
        { label: "Credit / debit cards", get: (f) => f.tender?.card ?? 0, project: true },
        { label: "Short / Over", get: (f) => f.shortOver ?? 0 },
        ...expenseGroupSpecs().map((x, i) => (i === 0 ? { ...x, section: "Expenses · small % = share of all expenses" } : x)),
        { label: "Total expenses", get: (f) => f.expenses.total, good: false, strong: true, project: true },
        ...gpSpecs("Gross profit"),
        { section: "Bottom line", label: "Profit / Loss", get: (f) => f.profit, strong: true },
        { label: "Profit taken out", get: (f) => f.profitTaken, neutral: true },
        { label: "Left after taken out", get: (f) => f.profit - f.profitTaken, strong: true },
      ]),
    },
  ];

  return {
    year,
    month,
    months: yms.map((ym) => ({
      ym,
      label: multiYear ? `${monthLabel(ym, true).slice(0, 3)} ’${ym.slice(2, 4)}` : monthLabel(ym, true).slice(0, 3),
      partial: running && ym === month,
      days: running && ym === month ? done : daysInMonth(ym),
    })),
    running: runningInfo,
    projLabels: {
      current: running ? `${monthLabel(month, true).slice(0, 3)} projected` : null,
      next: `${monthLabel(shiftMonth(month, 1), true).slice(0, 3)} projected`,
    },
    seasonal,
    hasData: figs.some((f) => f.hasSales),
    sections,
  };
}
