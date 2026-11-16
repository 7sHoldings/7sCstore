import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { todayISO } from "@/lib/day";
import { fmtMoney, fmtDate } from "@/lib/format";
import {
  compareWindows, defaultMonth, delta, isMonth, monthLabel, monthStart, monthsEnding, type CompareMode, type Tone,
} from "@/lib/compare";
import { getTrend, normUpc, productTrackingStart, productUnits } from "@/lib/monthCompare";
import { Card, PageHeader, EmptyState, Icon, Banner } from "@/components/ui";
import { CompareKpi, Section, ToneLegend, toneBg, toneText } from "@/components/compare";
import ProductCompareTable, { type ProductRow } from "@/components/ProductCompareTable";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function DepartmentMonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ month?: string; vs?: string; b?: string; full?: string; view?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  if (!loc) return <Card className="p-8"><EmptyState icon="category" title="No location" /></Card>;
  const dept = decodeURIComponent((await params).name);
  const sp = await searchParams;

  const today = todayISO();
  const month = isMonth(sp.month) ? sp.month : defaultMonth(today);
  const mode: CompareMode = sp.vs === "lastyear" ? "lastyear" : sp.vs === "custom" && isMonth(sp.b) ? "custom" : "prev";
  const full = sp.full === "1";
  const w = compareWindows(month, mode, sp.b, today, full);
  const running = today.slice(0, 7) === month;
  const view = sp.view === "months" ? "months" : "compare";
  const baseQuery = new URLSearchParams({ month, vs: w.mode, ...(w.mode === "custom" ? { b: w.b.ym } : {}), ...(full ? { full: "1" } : {}) });
  const q = (extra: Record<string, string> = {}) => new URLSearchParams({ ...Object.fromEntries(baseQuery), ...extra }).toString();
  const aShort = monthLabel(w.a.ym, true);
  const bShort = monthLabel(w.b.ym, true);

  // ---- department sales (POS), A vs B, and 12 months ----
  const months12 = monthsEnding(month, 12);
  const [aSales, bSales, trend, products, trackedFrom, inside] = await Promise.all([
    deptSales(loc, dept, w.a.start, w.a.end),
    deptSales(loc, dept, w.b.start, w.b.end),
    getTrend(loc, months12),
    prisma.product.findMany({
      where: { locationId: loc, department: { equals: dept, mode: "insensitive" } },
      select: { name: true, upc: true, size: true, sellingPrice: true },
    }),
    productTrackingStart(loc),
    insideSales(loc, w.a.start, w.a.end),
  ]);
  const d = delta(aSales, bSales);

  // ---- products: units sold from the POS's daily counter readings ----
  const byUpc = new Map<string, { name: string; size: string; price: number }>();
  for (const p of products) {
    const u = normUpc(p.upc);
    if (u && !byUpc.has(u)) byUpc.set(u, { name: p.name, size: p.size ?? "", price: p.sellingPrice });
  }
  const upcs = [...byUpc.keys()];

  // Months to show product-by-product: from the month tracking began up to the selected one.
  const productMonths = trackedFrom
    ? months12.filter((ym) => ym >= trackedFrom.toISOString().slice(0, 7))
    : [];
  const [unitsA, unitsB, ...perMonth] = await Promise.all([
    productUnits(loc, upcs, w.a.start, w.a.end, trackedFrom),
    productUnits(loc, upcs, w.b.start, w.b.end, trackedFrom),
    ...productMonths.map((ym) => {
      const s = monthStart(ym);
      const e = ym === w.a.ym ? w.a.end : monthStart(nextMonth(ym));
      return productUnits(loc, upcs, s, e, trackedFrom);
    }),
  ]);

  const rows: ProductRow[] = upcs
    .map((u) => {
      const p = byUpc.get(u)!;
      return {
        upc: u,
        name: p.name,
        size: p.size,
        price: p.price,
        a: unitsA ? unitsA.units.get(u) ?? 0 : null,
        b: unitsB ? unitsB.units.get(u) ?? 0 : null,
        months: perMonth.map((m) => (m ? m.units.get(u) ?? 0 : null)),
      };
    })
    .filter((r) => (r.a ?? 0) > 0 || (r.b ?? 0) > 0 || r.months.some((v) => (v ?? 0) > 0));

  const unitsTotalA = rows.reduce((s, r) => s + (r.a ?? 0), 0);
  const unitsTotalB = rows.reduce((s, r) => s + (r.b ?? 0), 0);
  const trackedLabel = trackedFrom ? fmtDate(trackedFrom) : null;

  return (
    <div>
      <a href={`/summary?${q()}#departments`} className="inline-flex items-center gap-1 text-body-sm text-primary hover:underline mb-2">
        <Icon name="arrow_back" className="text-[18px]" /> Monthly Summary
      </a>
      <PageHeader title={dept} subtitle={`${w.a.label}  vs  ${w.b.label}`} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <CompareKpi label={`${dept} sales`} icon="payments" d={d} bLabel={bShort} sub="From the POS department totals" />
        {unitsA && unitsB ? (
          <CompareKpi
            label="Units sold"
            icon="inventory_2"
            d={delta(unitsTotalA, unitsTotalB)}
            unit="units"
            bLabel={bShort}
            sub={unitsA.partial || unitsB.partial ? `Counted from ${trackedLabel}` : "All products in this department"}
          />
        ) : (
          <Card className="p-4">
            <div className="text-label-caps uppercase text-on-surface-variant tracking-wider">Units sold · {aShort}</div>
            <div className="tabular text-2xl font-bold text-on-surface mt-1.5">{unitsA ? Math.round(unitsTotalA).toLocaleString("en-US") : "—"}</div>
            <div className="text-body-sm text-on-surface-variant mt-1.5">
              {unitsA ? `Counted from ${trackedLabel}` : "Product tracking hadn’t started yet"}
              {unitsA && !unitsB ? ` · no product data for ${bShort}` : ""}
            </div>
          </Card>
        )}
        <Card className="p-4">
          <div className="text-label-caps uppercase text-on-surface-variant tracking-wider">Share of inside sales</div>
          <div className="tabular text-2xl font-bold text-on-surface mt-1.5">{inside ? `${((aSales / inside) * 100).toFixed(1)}%` : "—"}</div>
          <div className="text-body-sm text-on-surface-variant mt-1.5">of {fmtMoney(inside)} in {aShort}</div>
        </Card>
      </div>

      {/* 12-month department trend */}
      <Section id="trend" title={`${dept} — month by month`} icon="calendar_month" note="Coloured against the month before">
        <DeptTrend values={trend.map((t) => ({ ym: t.ym, v: t.depts.get(dept) ?? 0 }))} running={running ? month : null} />
      </Section>

      {/* Products */}
      <Section
        id="products"
        title={`Products in ${dept}`}
        icon="inventory_2"
        note={
          <span className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
            <a href={`?${q()}#products`} className={`px-3 py-1.5 ${view === "compare" ? "bg-primary text-on-primary" : "bg-surface-container-lowest"}`}>{aShort} vs {bShort}</a>
            <a href={`?${q({ view: "months" })}#products`} className={`px-3 py-1.5 ${view === "months" ? "bg-primary text-on-primary" : "bg-surface-container-lowest"}`}>Month by month</a>
          </span>
        }
      >
        {trackedFrom && (!unitsA || unitsA.partial || !unitsB) && (
          <div className="px-5 pt-4">
            <Banner tone="info" icon="info">
              Product-level sales are counted from the POS readings the daily sync saves, which began on {trackedLabel}.
              {!unitsA
                ? ` ${monthLabel(w.a.ym)} is before that — pick ${trackedFrom ? monthLabel(trackedFrom.toISOString().slice(0, 7)) : "a later month"} or later to see products.`
                : !unitsB
                ? ` ${monthLabel(w.b.ym)} is before that, so only ${aShort} is shown.`
                : ""}{" "}
              Each new month fills in automatically.
            </Banner>
          </div>
        )}
        {!trackedFrom ? (
          <EmptyState icon="inventory_2" title="No product readings yet" hint="Product sales appear after the daily POS sync has run a few days." />
        ) : rows.length === 0 ? (
          <EmptyState icon="inventory_2" title={`No product sales found for ${dept}`} hint="Products are matched by their POS department in the price book." />
        ) : (
          <ProductCompareTable
            rows={rows}
            aLabel={aShort}
            bLabel={bShort}
            monthLabels={productMonths.map((ym) => monthLabel(ym, true) + (ym === w.a.ym && w.a.days < 28 ? " (to date)" : ""))}
            view={view}
          />
        )}
        <div className="px-5 py-3 border-t border-outline-variant/40 flex flex-wrap items-center justify-between gap-2">
          <ToneLegend />
          <span className="text-[12px] text-on-surface-variant">Est. sales = units × current shelf price.</span>
        </div>
      </Section>
    </div>
  );
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

async function deptSales(loc: string, dept: string, start: Date, end: Date): Promise<number> {
  const rows = await prisma.sale.findMany({
    where: {
      locationId: loc,
      date: { gte: start, lt: end },
      category: { notIn: ["FUEL", "LOTTERY"] },
      OR: [{ note: { equals: `Modisoft ${dept}`, mode: "insensitive" } }, { note: { equals: dept, mode: "insensitive" } }],
    },
    select: { amount: true },
  });
  return Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
}

async function insideSales(loc: string, start: Date, end: Date): Promise<number> {
  const agg = await prisma.sale.aggregate({
    _sum: { amount: true },
    where: { locationId: loc, date: { gte: start, lt: end }, category: { notIn: ["FUEL", "LOTTERY"] } },
  });
  return Math.round((agg._sum.amount ?? 0) * 100) / 100;
}

function DeptTrend({ values, running }: { values: { ym: string; v: number }[]; running: string | null }) {
  const first = values.findIndex((x) => x.v !== 0);
  const shown = first < 0 ? [] : values.slice(first);
  if (!shown.length) return <EmptyState icon="calendar_month" title="No sales in the last 12 months" />;
  const max = Math.max(1, ...shown.map((x) => x.v));
  return (
    <div className="p-5">
      <div className="flex items-end gap-2 h-40">
        {shown.map((x, i) => {
          const prev = i > 0 ? shown[i - 1].v : null;
          const tone: Tone = prev === null || x.ym === running ? "none" : delta(x.v, prev).tone;
          const bar = tone === "good" ? "bg-secondary" : tone === "bad" ? "bg-error" : "bg-primary/60";
          return (
            <div key={x.ym} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${monthLabel(x.ym)}: ${fmtMoney(x.v)}`}>
              <div className={`w-full max-w-[44px] rounded-t-md ${bar}`} style={{ height: `${Math.max(2, (x.v / max) * 100)}%` }} />
            </div>
          );
        })}
      </div>
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-body-sm">
          <tbody>
            <tr>
              {shown.map((x) => (
                <td key={x.ym} className="px-1 py-1 text-center text-label-caps uppercase text-on-surface-variant whitespace-nowrap">
                  {monthLabel(x.ym, true).replace(" 20", " ’")}
                </td>
              ))}
            </tr>
            <tr>
              {shown.map((x, i) => {
                const prev = i > 0 ? shown[i - 1].v : null;
                const dd = prev === null ? null : delta(x.v, prev);
                const tone: Tone = !dd || x.ym === running ? "none" : dd.tone;
                return (
                  <td key={x.ym} className={`px-1 py-1.5 text-center tabular whitespace-nowrap rounded ${toneBg[tone]}`}>
                    <div className="font-semibold text-on-surface">{`$${Math.round(x.v).toLocaleString("en-US")}`}</div>
                    <div className={`text-[11px] ${toneText[tone]}`}>
                      {x.ym === running ? "to date" : dd && dd.pct !== null ? `${dd.pct > 0 ? "+" : ""}${dd.pct.toFixed(0)}%` : ""}
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
