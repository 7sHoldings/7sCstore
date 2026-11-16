import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { todayISO } from "@/lib/day";
import { fmtDate } from "@/lib/format";
import { daysInMonth, defaultMonth, isMonth, monthLabel, monthStart, shiftMonth } from "@/lib/compare";
import { getTrend, normUpc, productMonths, productTrackingStart, type ProductMonth } from "@/lib/monthCompare";
import { project } from "@/lib/projection";
import { monthRange } from "@/lib/monthsReport";
import { brandOf } from "@/lib/brand";
import { Card, PageHeader, EmptyState, Icon } from "@/components/ui";
import { MonthGrid, Section, ToneLegend, type GridMonth, type GridRow } from "@/components/compare";
import ProductMonthImport from "@/components/ProductMonthImport";
import SummaryExport from "@/components/SummaryExport";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function DepartmentMonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ month?: string; from?: string; brand?: string; measure?: string; vs?: string; b?: string; full?: string; view?: string }>;
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
  const brand = sp.brand?.trim() || "";
  const measure: "units" | "sales" = sp.measure === "sales" ? "sales" : "units";
  const running = today.slice(0, 7) === month;
  const done = running ? Math.max(1, Number(today.slice(8, 10)) - 1) : daysInMonth(month);
  const year = month.slice(0, 4);
  const from = isMonth(sp.from) && sp.from <= month ? sp.from : `${year}-01`;
  const yms = monthRange(from, month);
  const multiYear = yms[0].slice(0, 4) !== year;
  const lyYms = [shiftMonth(month, -13), shiftMonth(month, -12), shiftMonth(month, -11)];

  // Keep the summary's own filters on every link back and forth.
  const keep: Record<string, string> = {};
  for (const k of ["month", "from", "vs", "b", "full", "view"] as const) if (sp[k]) keep[k] = sp[k]!;
  const link = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams(keep);
    for (const [k, v] of Object.entries({ brand: brand || undefined, measure: measure === "sales" ? "sales" : undefined, ...extra })) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    return `?${q.toString()}`;
  };

  const windowOf = (ym: string) => {
    const start = monthStart(ym);
    const end = running && ym === month ? new Date(start.getTime() + done * 86400000) : monthStart(shiftMonth(ym, 1));
    return { ym, start, end };
  };

  const [trend, lyTrend, products, trackedFrom, uploadedMonths, store] = await Promise.all([
    getTrend(loc, yms),
    getTrend(loc, lyYms),
    prisma.product.findMany({
      where: { locationId: loc, department: { equals: dept, mode: "insensitive" } },
      select: { name: true, upc: true, size: true, sellingPrice: true },
    }),
    productTrackingStart(loc),
    prisma.productMonthSales.groupBy({ by: ["ym"], where: { locationId: loc }, orderBy: { ym: "asc" } }),
    prisma.location.findUnique({ where: { id: loc }, select: { name: true } }),
  ]);

  // ---- department $ by month (POS department totals) ----
  const deptVals = trend.map((t) => t.depts.get(dept) ?? 0);
  const lyDept = lyTrend.map((t) => t.depts.get(dept) ?? 0);
  const lyOk = lyTrend.every((t) => t.posSales > 0);
  const months: GridMonth[] = yms.map((ym) => ({
    ym,
    label: multiYear ? `${monthLabel(ym, true).slice(0, 3)} ’${ym.slice(2, 4)}` : monthLabel(ym, true).slice(0, 3),
    partial: running && ym === month,
  }));
  const projLabels = {
    current: running ? `${monthLabel(month, true).slice(0, 3)} projected` : null,
    next: `${monthLabel(shiftMonth(month, 1), true).slice(0, 3)} projected`,
  };
  const deptProj = project({
    values: deptVals,
    running: running ? { done, total: daysInMonth(month) } : null,
    lastYear: lyOk ? { prev: lyDept[0], cur: lyDept[1], next: lyDept[2] } : null,
  });

  // ---- products → brands ----
  const byUpc = new Map<string, { name: string; size: string; price: number; brand: string }>();
  for (const p of products) {
    const u = normUpc(p.upc);
    if (u && !byUpc.has(u)) byUpc.set(u, { name: p.name, size: p.size ?? "", price: p.sellingPrice, brand: brandOf(p.name) });
  }
  const upcs = [...byUpc.keys()];
  const [pm, lyPm] = await Promise.all([
    productMonths(loc, upcs, yms.map(windowOf), trackedFrom),
    productMonths(loc, upcs, lyYms.map((ym) => ({ ym, start: monthStart(ym), end: monthStart(shiftMonth(ym, 1)) })), trackedFrom),
  ]);
  const value = (m: ProductMonth, upc: string) => {
    const u = m.units.get(upc) ?? 0;
    return measure === "sales" ? u * (byUpc.get(upc)?.price ?? 0) : u;
  };
  const lastPm = pm[pm.length - 1];
  const lyPmOk = lyPm.every((m) => m.source !== null);
  const runningFor = (m: ProductMonth) =>
    m.source === null ? null : m.days < daysInMonth(m.ym) ? { done: m.days, total: daysInMonth(m.ym) } : null;

  const rowFor = (label: GridRow["label"], keys: string[], strong = false): GridRow & { total: number } => {
    const values = pm.map((m) => (m.source ? keys.reduce((s, u) => s + value(m, u), 0) : null));
    const proj = lastPm.source
      ? project({
          values: values.map((v) => v ?? 0),
          running: runningFor(lastPm),
          lastYear: lyPmOk ? { prev: sum(lyPm[0], keys, value), cur: sum(lyPm[1], keys, value), next: sum(lyPm[2], keys, value) } : null,
        })
      : null;
    return { label, values, unit: measure === "sales" ? "money" : "units", strong, proj, total: values.reduce<number>((a, b) => a + (b ?? 0), 0) };
  };

  const brands = new Map<string, string[]>();
  for (const [u, p] of byUpc) brands.set(p.brand, [...(brands.get(p.brand) ?? []), u]);

  let rows: (GridRow & { total: number })[];
  if (brand) {
    const keys = brands.get(brand) ?? [];
    rows = keys
      .map((u) => {
        const p = byUpc.get(u)!;
        return rowFor(
          <span>
            {p.name}
            {p.size ? <span className="text-on-surface-variant text-[11px] ml-1">{p.size}</span> : null}
          </span>,
          [u]
        );
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
    rows.push(rowFor(`All ${brand}`, keys, true));
  } else {
    rows = [...brands.entries()]
      .map(([b, keys]) =>
        Object.assign(
          rowFor(
            <a href={link({ brand: b }) + "#products"} className="text-primary font-medium hover:underline inline-flex items-center gap-0.5">
              {b} <span className="text-on-surface-variant text-[11px]">({keys.length})</span>
            </a>,
            keys
          ),
          { key: b }
        )
      )
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
    rows.push(rowFor(`All ${dept}`, upcs, true));
  }
  const anyProductData = pm.some((m) => m.source);
  // Start the product table at the first month that has product numbers.
  const firstData = Math.max(0, pm.findIndex((m) => m.source));
  const coverage = pm.map((m) => ({
    ym: m.ym,
    text: m.source === "upload" ? "uploaded" : m.source === "tracked" ? (m.days < daysInMonth(m.ym) ? `${m.days} days counted` : "counted") : "no data",
    ok: !!m.source,
  }));

  return (
    <div>
      <a href={`/summary?${new URLSearchParams(keep).toString()}#departments`} className="inline-flex items-center gap-1 text-body-sm text-primary hover:underline mb-2">
        <Icon name="arrow_back" className="text-[18px]" /> Monthly Summary
      </a>
      <PageHeader title={brand ? `${dept} · ${brand}` : dept} subtitle={`${monthLabel(from)} to ${monthLabel(month)}`} />
      <SummaryExport targetId="dept-export" fileName={`${dept}${brand ? "-" + brand : ""}-${month}`.replace(/[^\w-]+/g, "-")} />

      <div id="dept-export">
        <div className="hidden [.exporting_&]:block mb-4 pb-3 border-b border-outline-variant">
          <div className="text-headline-lg font-bold text-primary">{brand ? `${dept} · ${brand}` : dept} — {monthLabel(from)} to {monthLabel(month)}</div>
          <div className="text-body-sm text-on-surface-variant">7sCstores · {store?.name ?? ""} · {measure === "sales" ? "estimated sales ($)" : "units sold"}</div>
        </div>

        <Section id="sales" title={`${dept} sales by month`} icon="payments" note="From the POS department totals" shot={{ fileName: `${dept}-sales-${month}`.replace(/[^\w]+/g, "-"), caption: `7sCstores · ${store?.name ?? ""} · ${monthLabel(from)} to ${monthLabel(month)}` }}>
          <MonthGrid
            months={months}
            projLabels={projLabels}
            rows={[{ label: `${dept} sales`, values: deptVals, strong: true, proj: deptProj }]}
          />
        </Section>

        <Section
          id="products"
          shot={{ fileName: `${dept}-${brand || "brands"}-${month}`.replace(/[^\w]+/g, "-"), caption: `7sCstores · ${store?.name ?? ""} · ${monthLabel(from)} to ${monthLabel(month)} · ${measure === "sales" ? "est. sales $" : "units sold"}` }}
          title={brand ? `${brand} — products` : `Brands in ${dept}`}
          icon={brand ? "inventory_2" : "sell"}
          note={
            <span className="inline-flex flex-wrap items-center gap-2" data-noexport>
              {brand && (
                <a href={link({ brand: undefined }) + "#products"} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Icon name="arrow_back" className="text-[16px]" /> All brands
                </a>
              )}
              <span className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
                <a href={link({ measure: undefined }) + "#products"} className={`px-3 py-1.5 ${measure === "units" ? "bg-primary text-on-primary" : "bg-surface-container-lowest"}`}>Units</a>
                <a href={link({ measure: "sales" }) + "#products"} className={`px-3 py-1.5 ${measure === "sales" ? "bg-primary text-on-primary" : "bg-surface-container-lowest"}`}>Est. sales $</a>
              </span>
            </span>
          }
        >
          <div className="px-5 py-3 border-b border-outline-variant/40 flex flex-wrap gap-1.5 text-[12px]">
            <span className="text-on-surface-variant mr-1">Product data:</span>
            {coverage.map((c) => (
              <span key={c.ym} className={`px-2 py-0.5 rounded-full ${c.ok ? "bg-secondary-container/60 text-on-secondary-container" : "bg-surface-container text-on-surface-variant"}`}>
                {monthLabel(c.ym, true).slice(0, 3)} · {c.text}
              </span>
            ))}
          </div>
          {!anyProductData ? (
            <EmptyState icon="inventory_2" title="No product sales for these months yet" hint={trackedFrom ? `Daily product counts began ${fmtDate(trackedFrom)}. Upload past months below.` : "Upload past months below."} />
          ) : rows.length <= 1 ? (
            <EmptyState icon="inventory_2" title={`No product sales found${brand ? ` for ${brand}` : ""}`} />
          ) : (
            <MonthGrid months={months.slice(firstData)} projLabels={projLabels} rows={rows.map((r) => ({ ...r, values: r.values.slice(firstData) }))} totalLabel={measure === "sales" ? "Year total" : "Year units"} />
          )}
          <div className="px-5 py-3 border-t border-outline-variant/40 flex flex-wrap items-center justify-between gap-2">
            <ToneLegend />
            <span className="text-[12px] text-on-surface-variant">
              {brand ? "" : "Brands are grouped from the item names — tap one to see its sizes and flavours. "}
              {measure === "sales" ? "Est. sales = units × today’s shelf price. " : ""}
              A partly counted month is projected from the days counted.
            </span>
          </div>
          <div className="border-t border-outline-variant/40">
            <ProductMonthImport defaultMonth={shiftMonth(month, -1)} uploaded={uploadedMonths.map((u) => monthLabel(u.ym, true))} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function sum(m: ProductMonth, keys: string[], value: (m: ProductMonth, u: string) => number): number {
  return keys.reduce((s, u) => s + value(m, u), 0);
}
