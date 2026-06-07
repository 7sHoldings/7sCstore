import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { money, pctChange } from "@/lib/calc";
import { fmtMoney, fmtMoney4, fmtNumber, fmtDate, gradeLabel } from "@/lib/format";
import { Card, PageHeader, EmptyState, Icon, TrendChip } from "@/components/ui";
import { CategoryBars } from "@/components/charts";
import DayNav from "./DayNav";

export const dynamic = "force-dynamic";

function dayBounds(dateISO: string) {
  const start = new Date(dateISO + "T00:00:00");
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function deptName(note: string | null, category: string): string {
  if (note && note.startsWith("Modisoft ")) return note.slice(9) || category;
  return note || category;
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

  // Default to the most recent day that has sales.
  const latest = await prisma.sale.findFirst({ where: locWhere, orderBy: { date: "desc" }, select: { date: true } });
  const dateISO = sp.date || (latest?.date ?? new Date()).toISOString().slice(0, 10);
  const { start, end } = dayBounds(dateISO);
  const prev = dayBounds(new Date(start.getTime() - 86400000).toISOString().slice(0, 10));

  const [sales, fuelSales, prevSales] = await Promise.all([
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: start, lt: end } } }),
    prisma.fuelSale.findMany({ where: { ...locWhere, date: { gte: start, lt: end } } }),
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: prev.start, lt: prev.end } }, select: { amount: true } }),
  ]);

  // Totals
  const fuelSalesRows = sales.filter((s) => s.category === "FUEL");
  const storeRows = sales.filter((s) => s.category !== "FUEL");
  const totalSales = money(sales.reduce((s, x) => s + x.amount, 0));
  const fuelTotal = money(fuelSalesRows.reduce((s, x) => s + x.amount, 0));
  const storeTotal = money(storeRows.reduce((s, x) => s + x.amount, 0));
  const refunds = money(sales.reduce((s, x) => s + x.refund, 0));
  const gallons = money(fuelSales.reduce((s, x) => s + x.gallons, 0));
  const prevTotal = money(prevSales.reduce((s, x) => s + x.amount, 0));

  // Fuel by grade
  const gradeMap = new Map<string, { gallons: number; total: number; priceSum: number; n: number }>();
  for (const f of fuelSales) {
    const g = gradeMap.get(f.grade) ?? { gallons: 0, total: 0, priceSum: 0, n: 0 };
    g.gallons += f.gallons;
    g.total += f.total;
    g.priceSum += f.pricePerGallon;
    g.n += 1;
    gradeMap.set(f.grade, g);
  }
  const fuelByGrade = [...gradeMap.entries()].map(([grade, v]) => ({
    grade,
    gallons: money(v.gallons),
    total: money(v.total),
    price: v.n ? v.priceSum / v.n : 0,
  }));

  // Merchandise by department
  const deptMap = new Map<string, { sales: number; refund: number }>();
  for (const s of storeRows) {
    const name = deptName(s.note, s.category);
    const d = deptMap.get(name) ?? { sales: 0, refund: 0 };
    d.sales += s.amount;
    d.refund += s.refund;
    deptMap.set(name, d);
  }
  const departments = [...deptMap.entries()]
    .map(([name, v]) => ({ name, sales: money(v.sales), refund: money(v.refund) }))
    .sort((a, b) => b.sales - a.sales);
  const deptTotal = money(departments.reduce((s, d) => s + d.sales, 0));
  const deptRefund = money(departments.reduce((s, d) => s + d.refund, 0));

  const empty = sales.length === 0 && fuelSales.length === 0;

  return (
    <div>
      <PageHeader
        title="Daily Sales"
        subtitle={`POS closing summary · ${fmtDate(start)}`}
        actions={<DayNav date={dateISO} />}
      />

      {empty ? (
        <Card className="p-8">
          <EmptyState
            icon="event_busy"
            title="No sales for this day"
            hint="Pick another date, or run a sync/backfill on the Integrations page."
          />
        </Card>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Kpi label="Total Sales" value={fmtMoney(totalSales)} trend={pctChange(totalSales, prevTotal)} hint="vs previous day" barPct={100} />
            <Kpi label="Fuel Volume" value={`${fmtNumber(gallons)} G`} hint={fmtMoney(fuelTotal) + " in fuel"} barPct={totalSales ? (fuelTotal / totalSales) * 100 : 0} />
            <Kpi label="Store Sales" value={fmtMoney(storeTotal)} hint={`${departments.length} departments`} barPct={totalSales ? (storeTotal / totalSales) * 100 : 0} />
            <Kpi label="Refunds" value={fmtMoney(refunds)} accent="error" barPct={totalSales ? Math.min(100, (refunds / totalSales) * 100 * 10) : 0} />
          </div>

          <div className="grid grid-cols-12 gap-4 mb-6">
            {/* Sales by department (chart) */}
            <Card className="col-span-12 lg:col-span-8 p-5">
              <h3 className="font-semibold text-on-surface mb-4">Sales by Department</h3>
              {departments.length === 0 ? (
                <div className="text-on-surface-variant text-body-sm py-8 text-center">No store sales this day.</div>
              ) : (
                <CategoryBars items={departments.slice(0, 10).map((d) => ({ label: d.name, value: d.sales }))} />
              )}
            </Card>

            {/* Fuel sales panel */}
            <Card className="col-span-12 lg:col-span-4 p-5">
              <h3 className="font-semibold text-on-surface mb-4">Fuel Sales</h3>
              {fuelByGrade.length === 0 ? (
                <div className="text-on-surface-variant text-body-sm py-8 text-center">No fuel sales this day.</div>
              ) : (
                <div className="space-y-3">
                  {fuelByGrade.map((g) => (
                    <div key={g.grade} className="flex justify-between items-center p-3 bg-surface-container-low rounded-md">
                      <div>
                        <div className="text-label-caps uppercase text-on-surface-variant">{gradeLabel(g.grade)}</div>
                        <div className="text-body-lg font-bold tabular">{fmtNumber(g.gallons)} G</div>
                      </div>
                      <div className="text-right">
                        <div className="tabular font-semibold">{fmtMoney(g.total)}</div>
                        <div className="text-body-sm text-primary tabular">{fmtMoney4(g.price)}/G</div>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between items-center px-3 pt-2 border-t border-outline-variant/60">
                    <span className="text-label-caps uppercase text-on-surface-variant">Total</span>
                    <span className="tabular font-bold">{fmtNumber(gallons)} G · {fmtMoney(fuelTotal)}</span>
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Merchandise by department table */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-outline-variant/60 flex items-center justify-between">
              <h3 className="font-semibold text-on-surface">Merchandise Sales</h3>
              <span className="text-body-sm text-on-surface-variant">{departments.length} departments</span>
            </div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                    <th className="px-5 py-3">Department</th>
                    <th className="px-5 py-3 text-right">Sales</th>
                    <th className="px-5 py-3 text-right">Refund</th>
                    <th className="px-5 py-3 text-right">Sales %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {departments.map((d) => (
                    <tr key={d.name} className="hover:bg-surface-container-low/50">
                      <td className="px-5 py-3 font-medium text-on-surface">{d.name}</td>
                      <td className="px-5 py-3 text-right tabular">{fmtMoney(d.sales)}</td>
                      <td className={`px-5 py-3 text-right tabular ${d.refund > 0 ? "text-error" : "text-on-surface-variant"}`}>
                        {d.refund > 0 ? `-${fmtMoney(d.refund)}` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right tabular text-on-surface-variant">
                        {deptTotal !== 0 ? `${((d.sales / deptTotal) * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-container font-bold">
                    <td className="px-5 py-3">Grand Total</td>
                    <td className="px-5 py-3 text-right tabular">{fmtMoney(deptTotal)}</td>
                    <td className="px-5 py-3 text-right tabular text-error">{deptRefund > 0 ? `-${fmtMoney(deptRefund)}` : "—"}</td>
                    <td className="px-5 py-3 text-right tabular">100.0%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  trend,
  hint,
  accent,
  barPct,
}: {
  label: string;
  value: string;
  trend?: number | null;
  hint?: string;
  accent?: "error";
  barPct: number;
}) {
  return (
    <Card className="p-5">
      <p className="text-label-caps uppercase text-on-surface-variant mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <h3 className={`text-2xl font-bold tabular ${accent === "error" ? "text-error" : "text-primary"}`}>{value}</h3>
        {trend !== undefined && <TrendChip value={trend} />}
      </div>
      {hint && <p className="text-body-sm text-on-surface-variant mt-0.5">{hint}</p>}
      <div className="mt-3 h-1 w-full bg-surface-container rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${accent === "error" ? "bg-error" : "bg-primary"}`} style={{ width: `${Math.max(2, Math.min(100, barPct))}%` }} />
      </div>
    </Card>
  );
}
