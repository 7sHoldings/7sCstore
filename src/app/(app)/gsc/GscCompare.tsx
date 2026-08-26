"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Icon, Banner, EmptyState } from "@/components/ui";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { applyTargetPrices } from "./actions";

const BATCH = 200;

/** Why a price moved — which of the three candidates was the greatest. */
const SOURCE_LABEL: Record<"current" | "srp" | "target", string> = {
  current: "keep ours",
  srp: "GSC SRP",
  target: "margin",
};

export interface Row {
  upcNorm: string;
  upc: string;
  sku: string;
  description: string;
  orderId: string;
  unitsPerCase: number;
  sizeLabel: string | null;
  caseCost: number;
  unitCost: number;
  srp: number;
  productId: string | null;
  productName: string | null;
  department: string | null;
  currentPrice: number | null;
  marginPct: number;
  targetPrice: number;
  finalPrice: number;
  priceSource: "current" | "srp" | "target";
  needsRaise: boolean;
  increase: number;
  aboveSrp: boolean;
  unmatched: boolean;
}

export default function GscCompare({
  rows, total, page, pageCount, pageSize, view, dept, q, departments, canEdit, counts,
}: {
  rows: Row[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  view: string;
  dept: string;
  q: string;
  departments: string[];
  canEdit: boolean;
  counts: { raise: number; all: number; unmatched: number };
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ updated: number; pushed: number; pushFailed: number; live?: boolean } | null>(null);

  function go(next: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = { view, dept, q, ...next };
    if (merged.view && merged.view !== "raise") p.set("view", merged.view);
    if (merged.dept) p.set("dept", merged.dept);
    if (merged.q) p.set("q", merged.q);
    if (merged.page && merged.page !== "1") p.set("page", merged.page);
    setSelected(new Set());
    router.push(p.toString() ? `/gsc?${p}` : "/gsc");
  }

  // Only rows that have a product AND sit below the floor can be raised.
  const raisable = useMemo(() => rows.filter((r) => r.productId && r.needsRaise), [rows]);
  const allSelected = raisable.length > 0 && raisable.every((r) => selected.has(r.productId!));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of raisable) {
        if (allSelected) next.delete(r.productId!);
        else next.add(r.productId!);
      }
      return next;
    });
  }

  async function onApply() {
    const items = rows
      .filter((r) => r.productId && selected.has(r.productId) && r.needsRaise)
      .map((r) => ({ productId: r.productId!, newPrice: r.finalPrice }));
    if (items.length === 0) return;

    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(0);
    const tot = { updated: 0, pushed: 0, pushFailed: 0, live: false };

    for (let i = 0; i < items.length; i += BATCH) {
      const res = await applyTargetPrices({ items: items.slice(i, i + BATCH) });
      if (res.error) {
        setError(`${res.error} ${tot.updated} prices were applied before this point.`);
        setBusy(false);
        router.refresh();
        return;
      }
      tot.updated += res.updated ?? 0;
      tot.pushed += res.pushed ?? 0;
      tot.pushFailed += res.pushFailed ?? 0;
      tot.live = res.live ?? tot.live;
      setProgress(Math.min(i + BATCH, items.length));
    }

    setResult(tot);
    setSelected(new Set());
    setBusy(false);
    router.refresh();
  }

  const selCount = rows.filter((r) => r.productId && selected.has(r.productId) && r.needsRaise).length;

  return (
    <div>
      {result && (
        <Banner tone="success" icon="check_circle">
          Raised {fmtNumber(result.updated)} price{result.updated === 1 ? "" : "s"}.
          {result.pushed > 0 && ` ${fmtNumber(result.pushed)} pushed to the POS${result.live ? "" : " (sandbox)"}.`}
          {result.pushFailed > 0 && ` ${fmtNumber(result.pushFailed)} POS push${result.pushFailed === 1 ? "" : "es"} failed — those prices were left unchanged.`}
        </Banner>
      )}
      {error && <Banner tone="error" icon="error">{error}</Banner>}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4 bg-surface-container-low border border-outline-variant/60 rounded-lg p-3">
        <div className="flex gap-1">
          {[
            { k: "raise", label: `Need a raise (${fmtNumber(counts.raise)})` },
            { k: "all", label: `All (${fmtNumber(counts.all)})` },
            { k: "unmatched", label: `Unmatched (${fmtNumber(counts.unmatched)})` },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => go({ view: t.k, page: "1" })}
              className={`px-3 py-1.5 rounded-md text-body-sm font-medium ${
                view === t.k ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-container"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form
          className="flex-1 min-w-[12rem] flex gap-2"
          onSubmit={(e) => { e.preventDefault(); go({ q: query, page: "1" }); }}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, UPC or GSC SKU…"
            className="ft-input py-1.5 text-body-sm"
          />
          <button type="submit" className="ft-btn-secondary py-1.5">Go</button>
        </form>

        <select
          value={dept}
          onChange={(e) => go({ dept: e.target.value, page: "1" })}
          className="ft-input py-1.5 text-body-sm min-w-[10rem]"
        >
          <option value="">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Apply bar */}
      {canEdit && view !== "unmatched" && (
        <Card className="p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-body-sm font-semibold text-on-surface">
              <Icon name="trending_up" className="text-[20px] text-primary" />
              Raise to target
              <Badge tone={selCount ? "info" : "neutral"}>{fmtNumber(selCount)} selected</Badge>
            </span>
            <button onClick={onApply} disabled={!selCount || busy} className="ft-btn-primary py-2">
              {busy ? "Applying…" : `Raise ${fmtNumber(selCount)} price${selCount === 1 ? "" : "s"}`}
            </button>
            <span className="text-body-sm text-on-surface-variant">
              Each price becomes the greatest of your price, GSC&apos;s SRP and the margin target — so prices only ever go up.
            </span>
          </div>
          {busy && selCount > 0 && (
            <div className="mt-3">
              <div className="h-2 rounded-full bg-surface-container-low overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((progress / selCount) * 100)}%` }} />
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface flex items-center justify-between">
          <span>Price comparison</span>
          <span className="text-body-sm font-normal text-on-surface-variant tabular">
            {fmtNumber(total)} items · page {page} of {pageCount}
          </span>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={view === "raise" ? "check_circle" : "search_off"}
            title={view === "raise" ? "Every price is already the highest of the three" : "Nothing to show"}
            hint={view === "raise" ? "No item is below its SRP or its margin target." : "Try a different filter."}
          />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  {canEdit && view !== "unmatched" && (
                    <th className="px-3 py-3 w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all raisable on this page"
                        checked={allSelected}
                        onChange={toggleAll}
                        disabled={raisable.length === 0}
                        className="accent-primary w-4 h-4 align-middle"
                      />
                    </th>
                  )}
                  <th className="px-3 py-3">Scan Code</th>
                  <th className="px-3 py-3">Product</th>
                  <th className="px-3 py-3 text-right">Our Price</th>
                  <th className="px-3 py-3 text-right">GSC Case</th>
                  <th className="px-3 py-3 text-right">Count</th>
                  <th className="px-3 py-3 text-right">Unit Cost</th>
                  <th className="px-3 py-3 text-right">GSC SRP</th>
                  <th className="px-3 py-3 text-right">Target</th>
                  <th className="px-3 py-3 text-right">New Price</th>
                  <th className="px-3 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {rows.map((r) => {
                  const canPick = canEdit && r.productId && r.needsRaise;
                  return (
                    <tr key={r.upcNorm} className="hover:bg-surface-container-low/50">
                      {canEdit && view !== "unmatched" && (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.productName ?? r.description}`}
                            checked={!!r.productId && selected.has(r.productId)}
                            disabled={!canPick}
                            onChange={() => {
                              if (!r.productId) return;
                              setSelected((prev) => {
                                const n = new Set(prev);
                                if (n.has(r.productId!)) n.delete(r.productId!);
                                else n.add(r.productId!);
                                return n;
                              });
                            }}
                            className="accent-primary w-4 h-4 align-middle disabled:opacity-30"
                          />
                        </td>
                      )}
                      <td className="px-3 py-3 tabular text-on-surface-variant whitespace-nowrap">{r.upc}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-on-surface">{r.productName ?? r.description}</div>
                        <div className="text-body-sm text-on-surface-variant">
                          {r.department ?? "—"} · GSC {r.sku} · order #{r.orderId}
                          {r.marginPct != null && ` · ${r.marginPct}% target`}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular">
                        {r.currentPrice == null ? <span className="opacity-50">—</span> : fmtMoney(r.currentPrice)}
                      </td>
                      <td className="px-3 py-3 text-right tabular">{fmtMoney(r.caseCost)}</td>
                      <td className="px-3 py-3 text-right tabular text-on-surface-variant whitespace-nowrap">
                        {fmtNumber(r.unitsPerCase)}
                        {r.sizeLabel && <span className="opacity-60"> / {r.sizeLabel}</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular">${r.unitCost.toFixed(4)}</td>
                      <td className="px-3 py-3 text-right tabular text-on-surface-variant">
                        {r.srp > 0 ? fmtMoney(r.srp) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular text-on-surface-variant">
                        {fmtMoney(r.targetPrice)}
                      </td>
                      <td className="px-3 py-3 text-right tabular font-semibold">
                        <span className={r.needsRaise ? "text-secondary" : "text-on-surface-variant"}>
                          {fmtMoney(r.finalPrice)}
                        </span>
                        <span className="block text-body-sm text-on-surface-variant">
                          {r.needsRaise ? (
                            <span className="text-secondary">+{fmtMoney(r.increase)} · {SOURCE_LABEL[r.priceSource]}</span>
                          ) : (
                            "no change"
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          {r.unmatched ? (
                            <Badge tone="neutral">No product</Badge>
                          ) : r.needsRaise ? (
                            <Badge tone="warning">Raise</Badge>
                          ) : (
                            <Badge tone="success">OK</Badge>
                          )}
                          {r.aboveSrp && <Badge tone="error">Above SRP</Badge>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-outline-variant/60">
            <span className="text-body-sm text-on-surface-variant tabular">
              {fmtNumber((page - 1) * pageSize + 1)}–{fmtNumber(Math.min(page * pageSize, total))} of {fmtNumber(total)}
            </span>
            <div className="flex gap-2">
              <button onClick={() => go({ page: String(page - 1) })} disabled={page <= 1} className="ft-btn-secondary py-1.5 disabled:opacity-50">
                <Icon name="chevron_left" className="text-[18px]" /> Prev
              </button>
              <button onClick={() => go({ page: String(page + 1) })} disabled={page >= pageCount} className="ft-btn-secondary py-1.5 disabled:opacity-50">
                Next <Icon name="chevron_right" className="text-[18px]" />
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
