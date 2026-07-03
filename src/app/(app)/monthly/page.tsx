import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { money } from "@/lib/calc";
import { fmtMoney } from "@/lib/format";
import { buildSalesView, type SaleRow, type FuelRow } from "@/lib/salesView";
import { todayISO } from "@/lib/day";
import { Card, PageHeader, EmptyState, Icon } from "@/components/ui";

export const dynamic = "force-dynamic";

// One row per day for a month: Daily (merch), Fuel, Lottery, Total, Credit,
// Cash, Short/Over — computed the same way as the Daily Sales page so the
// numbers reconcile.
export default async function MonthlySalesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  const locWhere = loc ? { locationId: loc } : {};
  const sp = await searchParams;

  // Resolve the month window [monthStart, monthEnd) in UTC (matches how the
  // daily page buckets days on a UTC server).
  const monthParam = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : todayISO().slice(0, 7);
  const [yy, mm] = monthParam.split("-").map(Number);
  const monthStart = new Date(Date.UTC(yy, mm - 1, 1));
  const monthEnd = new Date(Date.UTC(yy, mm, 1));
  const prevMonth = new Date(Date.UTC(yy, mm - 2, 1)).toISOString().slice(0, 7);
  const nextMonth = new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 7);
  const monthLabel = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const [sales, fuelSales, settings] = await Promise.all([
    prisma.sale.findMany({
      where: { ...locWhere, date: { gte: monthStart, lt: monthEnd } },
      select: { paymentType: true, amount: true, refund: true, category: true, note: true, date: true },
    }),
    prisma.fuelSale.findMany({
      where: { ...locWhere, date: { gte: monthStart, lt: monthEnd } },
      select: { grade: true, gallons: true, total: true, pricePerGallon: true, date: true },
    }),
    loc
      ? prisma.setting.findMany({
          where: {
            OR: ["tax", "cashdrop", "cashmanual", "ccjobber", "lottomanual", "creditmanual"].map((p) => ({
              key: { startsWith: `${p}:${loc}:` },
            })),
          },
        })
      : Promise.resolve([] as { key: string; value: string }[]),
  ]);

  // Imported per-day summaries (from the Excel daily sheet) take precedence.
  const summaries = loc
    ? await prisma.dailySalesSummary.findMany({ where: { locationId: loc, date: { gte: monthStart, lt: monthEnd } } })
    : [];
  const summaryByDay = new Map(summaries.map((s) => [s.date.toISOString().slice(0, 10), s]));

  // ---- bucket sales / fuel by UTC day ----
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const salesByDay = new Map<string, SaleRow[]>();
  const fuelByDay = new Map<string, FuelRow[]>();
  for (const s of sales) {
    const k = dayKey(s.date);
    (salesByDay.get(k) ?? salesByDay.set(k, []).get(k)!).push(s);
  }
  for (const f of fuelSales) {
    const k = dayKey(f.date);
    (fuelByDay.get(k) ?? fuelByDay.set(k, []).get(k)!).push(f);
  }

  // ---- index dated settings by day ----
  const taxByDay = new Map<string, number>();
  const tenderByDay = new Map<string, { cash: number; card: number }>();
  const cashManualByDay = new Map<string, number>();
  const lottoManualByDay = new Map<string, { sales: number; payout: number; credit: number }>();
  const creditByDay = new Map<string, { ebt: number; otherCredit: number; payout: number; house: number }>();
  for (const r of settings) {
    const parts = r.key.split(":");
    const kind = parts[0];
    const date = parts[parts.length - 1];
    if (date < monthParam + "-01" || date >= nextMonth + "-01") continue;
    if (kind === "tax") {
      taxByDay.set(date, (taxByDay.get(date) ?? 0) + (Number(r.value) || 0));
    } else if (kind === "cashdrop" || kind === "ccjobber") {
      const t = tenderByDay.get(date) ?? { cash: 0, card: 0 };
      if (kind === "cashdrop") t.cash += Number(r.value) || 0;
      else t.card += Number(r.value) || 0;
      tenderByDay.set(date, t);
    } else if (kind === "cashmanual") {
      cashManualByDay.set(date, Number(r.value) || 0);
    } else if (kind === "lottomanual") {
      try {
        const o = JSON.parse(r.value);
        lottoManualByDay.set(date, { sales: Number(o.sales) || 0, payout: Number(o.payout) || 0, credit: Number(o.credit) || 0 });
      } catch { /* skip */ }
    } else if (kind === "creditmanual") {
      try {
        const o = JSON.parse(r.value) as Record<string, unknown>;
        const lines = (raw: unknown) =>
          Array.isArray(raw) ? raw.reduce((s, h) => s + (Number((h as { amount?: unknown }).amount) || 0), 0) : 0;
        const payout = Array.isArray(o.payouts) ? lines(o.payouts) : Number(o.payoutCash) || 0;
        creditByDay.set(date, {
          ebt: Number(o.ebt) || 0,
          otherCredit: Number(o.otherCredit) || 0,
          payout,
          house: lines(o.house),
        });
      } catch { /* skip */ }
    }
  }

  // A manual cash override wins over the POS Safe Drop for its day.
  for (const [date, cash] of cashManualByDay) {
    const t = tenderByDay.get(date) ?? { cash: 0, card: 0 };
    t.cash = cash;
    tenderByDay.set(date, t);
  }

  // ---- compute one row per day from the live records (used when there's no
  // imported Excel summary for that day) ----
  type Row = {
    date: string; daily: number; fuel: number; lottoSales: number; lottoPayout: number;
    total: number; credit: number; cash: number; shortOver: number; imported: boolean;
  };
  const computedByDay = new Map<string, Row>();
  const computedDays = new Set<string>([
    ...salesByDay.keys(), ...fuelByDay.keys(), ...tenderByDay.keys(),
    ...lottoManualByDay.keys(), ...creditByDay.keys(), ...taxByDay.keys(),
  ]);
  for (const date of computedDays) {
    const view = buildSalesView(salesByDay.get(date) ?? [], fuelByDay.get(date) ?? []);
    let lottoSales = 0, lottoPayout = 0;
    for (const d of view.lotto.depts) {
      if (d.sales >= 0) lottoSales += d.sales;
      else lottoPayout += -d.sales;
    }
    const realTax = taxByDay.get(date);
    const salesTax = realTax != null ? money(realTax) : 0; // POS only, no estimate
    const posSales = money(view.total.total + salesTax);
    const tender = tenderByDay.get(date);
    const cashRatio = view.total.total > 0 ? view.total.cash / view.total.total : 0;
    const cash = tender ? money(tender.cash) : money(view.total.cash + salesTax * cashRatio);
    const card = tender ? money(tender.card) : money(view.total.card + salesTax * (1 - cashRatio));
    const cm = creditByDay.get(date);
    const lm = lottoManualByDay.get(date);
    const lottoOver = lm ? money(view.lotto.split.total - money(lm.sales - lm.payout - lm.credit)) : 0;
    const shortOver = money(card + cash + (cm?.ebt ?? 0) + (cm?.otherCredit ?? 0) + (cm?.payout ?? 0) + (cm?.house ?? 0) + lottoOver - posSales);
    computedByDay.set(date, {
      date, daily: view.merch.split.total, fuel: view.fuel.split.total,
      lottoSales: money(lottoSales), lottoPayout: money(lottoPayout),
      total: posSales, credit: card, cash, shortOver, imported: false,
    });
  }

  // Merge: imported Excel summaries take precedence over computed rows.
  const allDays = new Set<string>([...computedByDay.keys(), ...summaryByDay.keys()]);
  const rows: Row[] = [...allDays].sort().map((date) => {
    const s = summaryByDay.get(date);
    if (s) {
      return {
        date, daily: money(s.dailySales), fuel: money(s.fuel),
        lottoSales: money(s.lotto + s.lottery), lottoPayout: money(s.lotteryPayout),
        total: money(s.total), credit: money(s.credit), cash: money(s.cash), shortOver: money(s.shortOver),
        imported: true,
      };
    }
    return computedByDay.get(date)!;
  });

  const sum = (k: keyof Row) => money(rows.reduce((acc, r) => acc + (r[k] as number), 0));
  const totals = rows.length
    ? {
        daily: sum("daily"), fuel: sum("fuel"), lottoSales: sum("lottoSales"),
        total: sum("total"), credit: sum("credit"), cash: sum("cash"), shortOver: sum("shortOver"),
      }
    : null;

  const fmtDay = (iso: string) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div>
      <PageHeader title="Monthly Sales" subtitle={`Day-by-day breakdown · ${monthLabel}`} />

      <div className="flex items-center gap-2 mb-4">
        <a href={`/monthly?month=${prevMonth}`} className="ft-btn-secondary"><Icon name="chevron_left" className="text-[18px]" /> Prev</a>
        <form className="flex items-center gap-2">
          <input type="month" name="month" defaultValue={monthParam} className="ft-input w-[170px]" />
          <button type="submit" className="ft-btn-secondary">Go</button>
        </form>
        <a href={`/monthly?month=${nextMonth}`} className="ft-btn-secondary">Next <Icon name="chevron_right" className="text-[18px]" /></a>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon="event_busy" title="No sales this month" hint="Pick another month above." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm whitespace-nowrap">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Daily Sales</th>
                  <th className="px-4 py-3 text-right">Fuel Sales</th>
                  <th className="px-4 py-3 text-right">Lottery</th>
                  <th className="px-4 py-3 text-right">Total Sales</th>
                  <th className="px-4 py-3 text-right">Credit</th>
                  <th className="px-4 py-3 text-right">Cash</th>
                  <th className="px-4 py-3 text-right">Short/Over</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {rows.map((r) => (
                  <tr key={r.date} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 text-on-surface">
                      <a href={`/daily?date=${r.date}`} className="hover:text-primary hover:underline">{fmtDay(r.date)}</a>
                    </td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(r.daily)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(r.fuel)}</td>
                    <td className="px-4 py-3 text-right tabular">
                      {fmtMoney(r.lottoSales)}
                      {r.lottoPayout > 0 && (
                        <span className="block text-on-surface-variant text-[11px]">payout {fmtMoney(r.lottoPayout)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular font-semibold text-on-surface">{fmtMoney(r.total)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(r.credit)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(r.cash)}</td>
                    <td className={`px-4 py-3 text-right tabular font-medium ${r.shortOver < 0 ? "text-error" : r.shortOver > 0 ? "text-secondary" : "text-on-surface-variant"}`}>
                      {fmtMoney(r.shortOver)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="bg-surface-container-low font-semibold text-on-surface border-t-2 border-outline-variant">
                    <td className="px-4 py-3">Total — {monthLabel}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(totals.daily)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(totals.fuel)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(totals.lottoSales)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(totals.total)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(totals.credit)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(totals.cash)}</td>
                    <td className={`px-4 py-3 text-right tabular ${totals.shortOver < 0 ? "text-error" : totals.shortOver > 0 ? "text-secondary" : ""}`}>
                      {fmtMoney(totals.shortOver)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
