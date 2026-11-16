"use client";
import { useMemo, useState } from "react";

export interface ProductRow {
  upc: string;
  name: string;
  size: string;
  price: number;
  a: number | null; // units in the selected month (null = not tracked)
  b: number | null; // units in the compared month
  months: (number | null)[]; // units per month for the month-by-month view
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const n0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

type SortKey = "a" | "b" | "diff" | "name" | "sales";

export default function ProductCompareTable({
  rows, aLabel, bLabel, monthLabels, view,
}: {
  rows: ProductRow[];
  aLabel: string;
  bLabel: string;
  monthLabels: string[];
  view: "compare" | "months";
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("a");
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = rows.filter((r) => !s || r.name.toLowerCase().includes(s) || r.upc.includes(s));
    const diff = (r: ProductRow) => (r.a ?? 0) - (r.b ?? 0);
    const cmp: Record<SortKey, (x: ProductRow, y: ProductRow) => number> = {
      a: (x, y) => (y.a ?? 0) - (x.a ?? 0),
      b: (x, y) => (y.b ?? 0) - (x.b ?? 0),
      diff: (x, y) => diff(y) - diff(x),
      sales: (x, y) => (y.a ?? 0) * y.price - (x.a ?? 0) * x.price,
      name: (x, y) => x.name.localeCompare(y.name),
    };
    return [...list].sort(cmp[sort]);
  }, [rows, q, sort]);

  const shown = showAll || q ? filtered : filtered.slice(0, 60);
  const hasB = rows.some((r) => r.b !== null);

  const th = (key: SortKey, label: string, right = true) => (
    <th className={`px-3 py-2.5 ${right ? "text-right" : "text-left"} whitespace-nowrap`}>
      <button type="button" onClick={() => setSort(key)} className={`uppercase ${sort === key ? "text-primary" : ""}`}>
        {label}{sort === key ? " ▾" : ""}
      </button>
    </th>
  );

  return (
    <div>
      <div className="px-5 py-3 flex flex-wrap items-center gap-3 border-b border-outline-variant/40">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a product (e.g. Coke, Monster)…"
          className="h-10 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface w-full sm:w-80"
        />
        <span className="text-body-sm text-on-surface-variant">{filtered.length} products sold</span>
      </div>

      <div className="overflow-x-auto">
        {view === "compare" ? (
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-label-caps text-on-surface-variant border-b border-outline-variant/50">
                {th("name", "Product", false)}
                <th className="px-3 py-2.5 text-right uppercase">Price</th>
                {th("a", `Units ${aLabel}`)}
                {hasB && th("b", `Units ${bLabel}`)}
                {hasB && th("diff", "Change")}
                {th("sales", `Est. sales ${aLabel}`)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const a = r.a ?? 0, b = r.b ?? 0, d = a - b;
                const tone = !hasB || r.b === null || d === 0 ? "" : d > 0 ? "bg-secondary/[0.09]" : "bg-error/[0.08]";
                const txt = !hasB || r.b === null || d === 0 ? "text-on-surface-variant" : d > 0 ? "text-secondary" : "text-error";
                const pct = b ? ((a - b) / b) * 100 : null;
                return (
                  <tr key={r.upc} className={`border-b border-outline-variant/30 ${tone}`}>
                    <td className="px-3 py-2 pl-5">
                      <div className="font-medium text-on-surface">{r.name}</div>
                      <div className="text-[11px] text-on-surface-variant tabular">{[r.size, r.upc].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular text-on-surface-variant">{r.price ? usd.format(r.price) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular font-semibold">{n0.format(a)}</td>
                    {hasB && <td className="px-3 py-2 text-right tabular text-on-surface-variant">{r.b === null ? "—" : n0.format(b)}</td>}
                    {hasB && (
                      <td className={`px-3 py-2 text-right tabular font-semibold whitespace-nowrap ${txt}`}>
                        {r.b === null ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${n0.format(Math.abs(d))}`}
                        {pct !== null && d !== 0 && <span className="font-normal text-[12px] ml-1 opacity-80">{pct > 0 ? "+" : ""}{pct.toFixed(0)}%</span>}
                        {pct === null && a > 0 && r.b !== null && <span className="font-normal text-[12px] ml-1 opacity-80">new</span>}
                      </td>
                    )}
                    <td className="px-5 py-2 text-right tabular">{usd.format(a * r.price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="text-body-sm min-w-full">
            <thead>
              <tr className="text-label-caps text-on-surface-variant border-b border-outline-variant/50">
                <th className="sticky left-0 bg-surface-container-lowest px-5 py-2.5 text-left uppercase min-w-[220px]">Product</th>
                {monthLabels.map((m) => <th key={m} className="px-3 py-2.5 text-right uppercase whitespace-nowrap">{m}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.upc} className="border-b border-outline-variant/30">
                  <td className="sticky left-0 bg-surface-container-lowest px-5 py-2">
                    <div className="font-medium text-on-surface">{r.name}</div>
                    <div className="text-[11px] text-on-surface-variant">{r.size}</div>
                  </td>
                  {r.months.map((v, i) => {
                    const prev = i > 0 ? r.months[i - 1] : null;
                    const last = i === r.months.length - 1;
                    const t = v === null || prev === null || prev === undefined || last ? "" : v > prev ? "bg-secondary/[0.09] text-secondary" : v < prev ? "bg-error/[0.08] text-error" : "";
                    return <td key={i} className={`px-3 py-2 text-right tabular ${t}`}>{v === null ? "—" : n0.format(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!showAll && !q && filtered.length > shown.length && (
        <div className="px-5 py-3 border-t border-outline-variant/40">
          <button type="button" onClick={() => setShowAll(true)} className="ft-btn-secondary">Show all {filtered.length} products</button>
        </div>
      )}
    </div>
  );
}
