import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { prisma } from "@/lib/db";
import { gradesFromFuel, type FuelRow } from "@/lib/salesView";
import { rangeFor, customRange, type PeriodKey, type Range } from "@/lib/period";
import { money } from "@/lib/calc";
import { fmtMoney, fmtMoney4, fmtNumber, gradeLabel } from "@/lib/format";
import { toISODate, yesterdayISO } from "@/lib/day";
import { getLatestReading, getReorderLevel, TANK_GRADES } from "@/lib/tank";
import { TANK_CAPACITY } from "@/lib/tankChart";
import { Card, PageHeader, EmptyState, Icon } from "@/components/ui";
import PeriodBar from "@/components/PeriodBar";
import { setReorderLevels } from "./actions";

export const dynamic = "force-dynamic";

type Row = FuelRow & { date: Date };

export default async function FuelPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  const locWhere = loc ? { locationId: loc } : {};
  const sp = await searchParams;

  // Resolve window; default to yesterday.
  let range: Range;
  let period: PeriodKey | "" = "";
  if (sp.from && sp.to) {
    range = customRange(sp.from, sp.to);
  } else if (sp.period) {
    period = sp.period as PeriodKey;
    range = rangeFor(period);
  } else {
    period = "yest";
    const start = new Date(yesterdayISO() + "T00:00:00");
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    range = { start, end, label: "Yesterday" };
  }

  const fuelSales = (await prisma.fuelSale.findMany({
    where: { ...locWhere, date: { gte: range.start, lt: range.end } },
    select: { grade: true, gallons: true, total: true, pricePerGallon: true, date: true },
  })) as Row[];

  const grades = gradesFromFuel(fuelSales);
  const totalGallons = money(fuelSales.reduce((s, x) => s + x.gallons, 0));
  const totalSales = money(fuelSales.reduce((s, x) => s + x.total, 0));

  // Per-day breakdown (reallocated grades), newest first.
  const byDay = new Map<string, Row[]>();
  for (const f of fuelSales) {
    const d = toISODate(f.date);
    const arr = byDay.get(d) ?? [];
    arr.push(f);
    byDay.set(d, arr);
  }
  const dayRows = [...byDay.entries()].map(([date, rows]) => {
    const g = gradesFromFuel(rows);
    const gal = (k: string) => g.find((x) => x.grade === k)?.gallons ?? 0;
    return {
      date,
      regular: gal("REGULAR"),
      premium: gal("PREMIUM"),
      diesel: gal("DIESEL"),
      gallons: money(rows.reduce((s, x) => s + x.gallons, 0)),
      sales: money(rows.reduce((s, x) => s + x.total, 0)),
    };
  }).sort((a, b) => (a.date < b.date ? 1 : -1));

  // Tank balances (latest stick reading) + reorder suggestions.
  const canEditReorder = can(session.role, "viewAll");
  const distinctDays = Math.max(1, byDay.size);
  const tanks = await Promise.all(TANK_GRADES.map(async (g) => {
    const [reading, reorder] = await Promise.all([
      loc ? getLatestReading(loc, g) : Promise.resolve(null),
      loc ? getReorderLevel(loc, g) : Promise.resolve(0),
    ]);
    const avgDaily = (grades.find((x) => x.grade === g)?.gallons ?? 0) / distinctDays;
    const balance = reading?.gallons ?? null;
    const daysLeft = balance != null && avgDaily > 0 ? Math.floor((balance - reorder) / avgDaily) : null;
    const orderNow = balance != null && reorder > 0 && balance <= reorder;
    return { grade: g, reading, reorder, avgDaily, balance, daysLeft, orderNow };
  }));

  return (
    <div>
      <PageHeader title="Fuel Sales" subtitle={`By grade · ${range.label} (Mid-grade blended into Regular & Premium)`} />

      <div className="mb-6"><PeriodBar period={period} from={sp.from} to={sp.to} path="/fuel" /></div>

      <Card className="overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-outline-variant/60 flex items-center justify-between">
          <h3 className="font-semibold text-on-surface">Tank balance &amp; reorder</h3>
          <span className="text-body-sm text-on-surface-variant">From latest stick reading · usage from {range.label}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5">
          {tanks.map((t) => {
            const pct = t.balance != null ? Math.min(100, Math.round((t.balance / TANK_CAPACITY) * 100)) : 0;
            return (
              <div key={t.grade} className={`rounded-lg border p-4 ${t.orderNow ? "border-error/50 bg-error/[0.05]" : "border-outline-variant/60"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-label-caps uppercase text-on-surface-variant">{gradeLabel(t.grade)}</span>
                  {t.orderNow && <span className="text-label-caps uppercase bg-error-container text-on-error-container rounded-full px-2 py-0.5">Order now</span>}
                </div>
                <div className="text-2xl font-bold tabular text-primary">{t.balance != null ? `${fmtNumber(t.balance)} gal` : "—"}</div>
                <div className="mt-2 h-2 rounded-full bg-surface-container-low overflow-hidden">
                  <div className={`h-full ${t.orderNow ? "bg-error" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 space-y-0.5 text-body-sm text-on-surface-variant">
                  <div>Reading: {t.reading ? `${t.reading.inches}″ on ${t.reading.date}` : "none yet"}</div>
                  <div>Reorder at: <span className="tabular">{t.reorder ? `${fmtNumber(t.reorder)} gal` : "not set"}</span></div>
                  <div>Avg use: <span className="tabular">{fmtNumber(Math.round(t.avgDaily))} gal/day</span></div>
                  <div className="font-medium text-on-surface">
                    {t.balance == null ? "Enter a tank reading to track this."
                      : t.orderNow ? `Below reorder level — order ~${fmtNumber(Math.max(0, Math.round(TANK_CAPACITY - t.balance)))} gal to fill.`
                      : t.daysLeft != null ? `~${t.daysLeft} day${t.daysLeft === 1 ? "" : "s"} to reorder level`
                      : "Set a reorder level to get a reminder."}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {canEditReorder && (
          <form action={setReorderLevels} className="px-5 pb-5 flex flex-wrap items-end gap-3 border-t border-outline-variant/60 pt-4">
            <span className="text-body-sm text-on-surface-variant w-full">Set the reorder reminder level (gallons) per grade:</span>
            {tanks.map((t) => (
              <div key={t.grade}>
                <label className="ft-label">{gradeLabel(t.grade)}</label>
                <input name={`reorder_${t.grade}`} type="number" step="1" min="0" defaultValue={t.reorder || ""} className="ft-input w-32" placeholder="gal" />
              </div>
            ))}
            <button type="submit" className="ft-btn-primary"><Icon name="save" className="text-[18px]" /> Save levels</button>
          </form>
        )}
      </Card>

      {fuelSales.length === 0 ? (
        <Card className="p-8"><EmptyState icon="local_gas_station" title="No fuel sales in this period" hint="Pick another period, or run a sync/backfill." /></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {grades.map((g) => (
              <Card key={g.grade} className="p-5">
                <div className="text-label-caps uppercase text-on-surface-variant">{gradeLabel(g.grade)}</div>
                <div className="text-2xl font-bold tabular text-primary mt-1">{fmtMoney(g.total)}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-body-sm">
                  <div className="bg-surface-container-low rounded-md px-2.5 py-1.5">
                    <div className="text-label-caps uppercase text-on-surface-variant">Gallons</div>
                    <div className="tabular font-semibold">{fmtNumber(g.gallons)}</div>
                  </div>
                  <div className="bg-surface-container-low rounded-md px-2.5 py-1.5">
                    <div className="text-label-caps uppercase text-on-surface-variant">$/gal</div>
                    <div className="tabular font-semibold">{fmtMoney4(g.price)}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-outline-variant/60 flex items-center justify-between">
              <h3 className="font-semibold text-on-surface">Daily fuel sales</h3>
              <span className="text-body-sm text-on-surface-variant">{fmtNumber(totalGallons)} gal · {fmtMoney(totalSales)}</span>
            </div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3 text-right">Regular gal</th>
                    <th className="px-5 py-3 text-right">Premium gal</th>
                    <th className="px-5 py-3 text-right">Diesel gal</th>
                    <th className="px-5 py-3 text-right">Total gal</th>
                    <th className="px-5 py-3 text-right">Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {dayRows.map((r) => (
                    <tr key={r.date} className="hover:bg-surface-container-low/50">
                      <td className="px-5 py-3 tabular font-medium text-on-surface"><a href={`/daily?date=${r.date}`} className="hover:text-primary">{r.date}</a></td>
                      <td className="px-5 py-3 text-right tabular">{fmtNumber(r.regular)}</td>
                      <td className="px-5 py-3 text-right tabular">{fmtNumber(r.premium)}</td>
                      <td className="px-5 py-3 text-right tabular">{fmtNumber(r.diesel)}</td>
                      <td className="px-5 py-3 text-right tabular">{fmtNumber(r.gallons)}</td>
                      <td className="px-5 py-3 text-right tabular">{fmtMoney(r.sales)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-container font-bold">
                    <td className="px-5 py-3">Total</td>
                    <td className="px-5 py-3 text-right tabular">{fmtNumber(grades.find((g) => g.grade === "REGULAR")?.gallons ?? 0)}</td>
                    <td className="px-5 py-3 text-right tabular">{fmtNumber(grades.find((g) => g.grade === "PREMIUM")?.gallons ?? 0)}</td>
                    <td className="px-5 py-3 text-right tabular">{fmtNumber(grades.find((g) => g.grade === "DIESEL")?.gallons ?? 0)}</td>
                    <td className="px-5 py-3 text-right tabular">{fmtNumber(totalGallons)}</td>
                    <td className="px-5 py-3 text-right tabular">{fmtMoney(totalSales)}</td>
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
