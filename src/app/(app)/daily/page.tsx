import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { money, pctChange } from "@/lib/calc";
import { fmtMoney, fmtMoney4, fmtNumber, fmtDate, gradeLabel } from "@/lib/format";
import { Card, PageHeader, EmptyState, TrendChip } from "@/components/ui";
import DayNav from "./DayNav";

export const dynamic = "force-dynamic";

type Row = { paymentType: string; amount: number; refund: number; category: string; note: string | null };

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

/** Cash / credit-debit / total for a set of rows (non-cash treated as card). */
function split(rows: { paymentType: string; amount: number }[]) {
  let cash = 0;
  let card = 0;
  for (const r of rows) {
    if (r.paymentType === "CASH") cash += r.amount;
    else card += r.amount;
  }
  return { cash: money(cash), card: money(card), total: money(cash + card) };
}

/** Group rows by department name → { sales, refund }. */
function byDept(rows: Row[]) {
  const m = new Map<string, { sales: number; refund: number }>();
  for (const r of rows) {
    const name = deptName(r.note, r.category);
    const d = m.get(name) ?? { sales: 0, refund: 0 };
    d.sales += r.amount;
    d.refund += r.refund;
    m.set(name, d);
  }
  return [...m.entries()]
    .map(([name, v]) => ({ name, sales: money(v.sales), refund: money(v.refund) }))
    .sort((a, b) => b.sales - a.sales);
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
    prisma.fuelSale.findMany({ where: { ...locWhere, date: { gte: start, lt: end } } }),
    prisma.sale.findMany({ where: { ...locWhere, date: { gte: prev.start, lt: prev.end } }, select: { amount: true } }),
  ]);

  // Buckets: merchandise (everything except fuel + lottery), lottery, fuel.
  const merchRows = sales.filter((s) => s.category !== "FUEL" && s.category !== "LOTTERY");
  const lottoRows = sales.filter((s) => s.category === "LOTTERY");
  const fuelRows = sales.filter((s) => s.category === "FUEL");

  const merch = split(merchRows);
  const lotto = split(lottoRows);
  const fuel = split(fuelRows);
  const totalAll = split(sales);
  const prevTotal = money(prevSales.reduce((s, x) => s + x.amount, 0));

  const merchDepts = byDept(merchRows);
  const lottoDepts = byDept(lottoRows);
  const merchRefund = money(merchDepts.reduce((s, d) => s + d.refund, 0));

  // Fuel by grade (gallons / price / total)
  const gradeMap = new Map<string, { gallons: number; total: number; priceSum: number; n: number }>();
  for (const f of fuelSales) {
    const g = gradeMap.get(f.grade) ?? { gallons: 0, total: 0, priceSum: 0, n: 0 };
    g.gallons += f.gallons; g.total += f.total; g.priceSum += f.pricePerGallon; g.n += 1;
    gradeMap.set(f.grade, g);
  }
  const fuelByGrade = [...gradeMap.entries()].map(([grade, v]) => ({
    grade, gallons: money(v.gallons), total: money(v.total), price: v.n ? v.priceSum / v.n : 0,
  })).sort((a, b) => b.total - a.total);
  const gallons = money(fuelSales.reduce((s, x) => s + x.gallons, 0));

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
          <EmptyState icon="event_busy" title="No sales for this day" hint="Pick another date, or run a sync/backfill on Integrations." />
        </Card>
      ) : (
        <>
          {/* Summary cards — each with cash / credit-debit / total */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <MetricCard label="Daily Sales" sub="Merchandise only" s={merch} icon="shopping_bag" />
            <MetricCard label="Lottery / Lotto" sub="incl. payouts" s={lotto} icon="confirmation_number" />
            <MetricCard label="Fuel Sales" sub={`${fmtNumber(gallons)} gal`} s={fuel} icon="local_gas_station" />
            <MetricCard label="Total Sales" sub="all sources" s={totalAll} icon="payments" trend={pctChange(totalAll.total, prevTotal)} highlight />
          </div>

          {/* Section 1 — Daily (Merchandise) Sales */}
          <Section title="Daily Sales — Merchandise" s={merch} className="mb-6">
            <DeptTable rows={merchDepts} total={merch.total} refundTotal={merchRefund} />
          </Section>

          {/* Section 2 — Lottery / Lotto */}
          <Section title="Lottery / Lotto Sales & Payouts" s={lotto} className="mb-6">
            {lottoDepts.length === 0 ? (
              <Empty>No lottery activity this day.</Empty>
            ) : (
              <DeptTable rows={lottoDepts} total={lotto.total} refundTotal={0} allowNegative />
            )}
          </Section>

          {/* Section 3 — Fuel Sales */}
          <Section title="Fuel Sales" s={fuel} extra={`${fmtNumber(gallons)} gal`}>
            {fuelByGrade.length === 0 ? (
              <Empty>No fuel sales this day.</Empty>
            ) : (
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-body-sm">
                  <thead>
                    <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                      <th className="px-5 py-3">Grade</th>
                      <th className="px-5 py-3 text-right">Gallons</th>
                      <th className="px-5 py-3 text-right">Price / gal</th>
                      <th className="px-5 py-3 text-right">Sales</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/40">
                    {fuelByGrade.map((g) => (
                      <tr key={g.grade} className="hover:bg-surface-container-low/50">
                        <td className="px-5 py-3 font-medium text-on-surface">{gradeLabel(g.grade)}</td>
                        <td className="px-5 py-3 text-right tabular">{fmtNumber(g.gallons)}</td>
                        <td className="px-5 py-3 text-right tabular">{fmtMoney4(g.price)}</td>
                        <td className="px-5 py-3 text-right tabular">{fmtMoney(g.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-container font-bold">
                      <td className="px-5 py-3">Total</td>
                      <td className="px-5 py-3 text-right tabular">{fmtNumber(gallons)}</td>
                      <td className="px-5 py-3"></td>
                      <td className="px-5 py-3 text-right tabular">{fmtMoney(fuel.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label, sub, s, icon, trend, highlight,
}: {
  label: string; sub?: string; s: { cash: number; card: number; total: number };
  icon: string; trend?: number | null; highlight?: boolean;
}) {
  return (
    <Card className={`p-5 ${highlight ? "ring-1 ring-primary/30" : ""}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-label-caps uppercase text-on-surface-variant">{label}</span>
        <span className="material-symbols-outlined text-[20px] text-primary opacity-70">{icon}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular text-primary">{fmtMoney(s.total)}</span>
        {trend !== undefined && <TrendChip value={trend} />}
      </div>
      {sub && <p className="text-body-sm text-on-surface-variant mt-0.5">{sub}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 text-body-sm">
        <div className="bg-surface-container-low rounded-md px-2.5 py-1.5">
          <div className="text-label-caps uppercase text-on-surface-variant">Cash</div>
          <div className="tabular font-semibold">{fmtMoney(s.cash)}</div>
        </div>
        <div className="bg-surface-container-low rounded-md px-2.5 py-1.5">
          <div className="text-label-caps uppercase text-on-surface-variant">Credit/Debit</div>
          <div className="tabular font-semibold">{fmtMoney(s.card)}</div>
        </div>
      </div>
    </Card>
  );
}

function Section({
  title, s, extra, className, children,
}: {
  title: string; s: { cash: number; card: number; total: number };
  extra?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <Card className={`overflow-hidden ${className ?? ""}`}>
      <div className="px-5 py-4 border-b border-outline-variant/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h3 className="font-semibold text-on-surface">{title}</h3>
        <div className="flex items-center gap-2 text-body-sm">
          <Pill label="Cash" value={fmtMoney(s.cash)} />
          <Pill label="Credit/Debit" value={fmtMoney(s.card)} />
          <Pill label="Total" value={fmtMoney(s.total)} strong />
          {extra && <span className="text-on-surface-variant tabular">· {extra}</span>}
        </div>
      </div>
      {children}
    </Card>
  );
}

function Pill({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className={`inline-flex flex-col items-end rounded-md px-2.5 py-1 ${strong ? "bg-primary text-on-primary" : "bg-surface-container-low"}`}>
      <span className={`text-[10px] uppercase tracking-wide ${strong ? "text-on-primary/80" : "text-on-surface-variant"}`}>{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </span>
  );
}

function DeptTable({
  rows, total, refundTotal, allowNegative,
}: {
  rows: { name: string; sales: number; refund: number }[];
  total: number; refundTotal: number; allowNegative?: boolean;
}) {
  return (
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
          {rows.map((d) => (
            <tr key={d.name} className="hover:bg-surface-container-low/50">
              <td className="px-5 py-3 font-medium text-on-surface">{d.name}</td>
              <td className={`px-5 py-3 text-right tabular ${allowNegative && d.sales < 0 ? "text-error" : ""}`}>{fmtMoney(d.sales)}</td>
              <td className={`px-5 py-3 text-right tabular ${d.refund > 0 ? "text-error" : "text-on-surface-variant"}`}>{d.refund > 0 ? `-${fmtMoney(d.refund)}` : "—"}</td>
              <td className="px-5 py-3 text-right tabular text-on-surface-variant">{total !== 0 ? `${((d.sales / total) * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-surface-container font-bold">
            <td className="px-5 py-3">Grand Total</td>
            <td className="px-5 py-3 text-right tabular">{fmtMoney(total)}</td>
            <td className="px-5 py-3 text-right tabular text-error">{refundTotal > 0 ? `-${fmtMoney(refundTotal)}` : "—"}</td>
            <td className="px-5 py-3 text-right tabular">100.0%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-on-surface-variant text-body-sm py-8 text-center">{children}</div>;
}
