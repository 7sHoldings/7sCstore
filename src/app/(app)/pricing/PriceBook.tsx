"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Icon, Banner, EmptyState } from "@/components/ui";
import Modal from "@/components/Modal";
import { fmtMoney, fmtNumber, catLabel } from "@/lib/format";
import {
  applyBulkPrice,
  marginPct,
  fmtMargin,
  isBelowCost,
  BULK_MODES,
  ROUND_RULES,
  type BulkMode,
  type RoundRule,
} from "@/lib/pricing";
import { filterToParams, type PriceBookFilter } from "@/lib/pricebook/filter";
import {
  applyBulkPriceBatch,
  finishBulkUpdate,
  matchingProductIds,
  updateProductPricing,
} from "./actions";

/** Ids per bulk request — matches the server-side batch cap. */
const BATCH_SIZE = 1000;

export interface PriceRow {
  id: string;
  name: string;
  upc: string | null;
  department: string | null;
  category: string;
  currentCost: number;
  sellingPrice: number;
  qtyOnHand: number;
  size: string | null;
}

interface Props {
  products: PriceRow[];
  departments: { name: string; count: number }[];
  canEdit: boolean;
  filter: PriceBookFilter;
  page: number;
  pageCount: number;
  matching: number;
  pageSize: number;
  belowCostCount: number;
}

export default function PriceBook({
  products,
  departments,
  canEdit,
  filter,
  page,
  pageCount,
  matching,
  pageSize,
  belowCostCount,
}: Props) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();

  const [query, setQuery] = useState(filter.q ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** True when the change should hit every row matching the filter, not just this page. */
  const [allMatching, setAllMatching] = useState(false);
  const [editing, setEditing] = useState<PriceRow | null>(null);

  const [mode, setMode] = useState<BulkMode>("pct");
  const [value, setValue] = useState("");
  const [rounding, setRounding] = useState<RoundRule>("none");

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);

  // Filters live in the URL so the server decides what's shown — the table only
  // ever holds one page, which keeps a 16k-item price book responsive.
  function pushFilter(next: PriceBookFilter) {
    setSelected(new Set());
    setAllMatching(false);
    const qs = filterToParams(next);
    startNav(() => router.push(qs ? `/pricing?${qs}` : "/pricing"));
  }

  function goToPage(p: number) {
    const qs = filterToParams(filter, p);
    startNav(() => router.push(qs ? `/pricing?${qs}` : "/pricing"));
  }

  const numeric = value.trim() === "" ? null : Number(value);
  const valueValid = numeric !== null && isFinite(numeric);

  const targetCount = allMatching ? matching : selected.size;
  const canApply = canEdit && valueValid && targetCount > 0 && !busy;

  const preview = useMemo(() => {
    const map = new Map<string, number>();
    if (!valueValid) return map;
    for (const p of products) {
      if (allMatching || selected.has(p.id)) {
        map.set(p.id, applyBulkPrice(p.sellingPrice, mode, numeric!, rounding));
      }
    }
    return map;
  }, [products, selected, allMatching, mode, numeric, rounding, valueValid]);

  const previewOn = preview.size > 0;

  function toggle(id: string) {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allPageSelected = products.length > 0 && products.every((p) => selected.has(p.id));

  function togglePage() {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of products) {
        if (allPageSelected) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }

  async function onApply() {
    if (!canApply) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(0);

    try {
      // Resolve the target ids: either the explicit page selection, or every
      // row matching the current filter (fetched server-side).
      let ids: string[];
      if (allMatching) {
        const res = await matchingProductIds({
          q: filter.q,
          dept: filter.dept,
          below: filter.below,
          noCost: filter.noCost,
          noPrice: filter.noPrice,
        });
        if (res.error || !res.ids) {
          setError(res.error ?? "Could not read the product list.");
          setBusy(false);
          return;
        }
        ids = res.ids;
        if (res.truncated) {
          setError(`Only the first ${fmtNumber(ids.length)} matching items will be repriced.`);
        }
      } else {
        ids = [...selected];
      }

      let updated = 0;
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        const res = await applyBulkPriceBatch({ ids: batch, mode, value: numeric!, rounding });
        if (res.error) {
          setError(`${res.error} ${fmtNumber(updated)} items were repriced before this point.`);
          setBusy(false);
          await finishBulkUpdate();
          router.refresh();
          return;
        }
        updated += res.updated ?? 0;
        setProgress(Math.min(i + BATCH_SIZE, ids.length));
      }

      await finishBulkUpdate();
      setResult(updated);
      setSelected(new Set());
      setAllMatching(false);
      setValue("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const modeHint = BULK_MODES.find((m) => m.value === mode)?.hint;
  const flag = filter.below ? "below" : filter.noCost ? "nocost" : filter.noPrice ? "noprice" : "";

  return (
    <div>
      {result !== null && (
        <Banner tone={result ? "success" : "info"} icon={result ? "check_circle" : "info"}>
          {result
            ? `Repriced ${fmtNumber(result)} ${result === 1 ? "item" : "items"}.`
            : "No prices changed — the new prices matched the current ones."}
        </Banner>
      )}
      {error && <Banner tone="error" icon="error">{error}</Banner>}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4 bg-surface-container-low border border-outline-variant/60 rounded-lg p-3">
        <form
          className="flex-1 min-w-[14rem]"
          onSubmit={(e) => {
            e.preventDefault();
            pushFilter({ ...filter, q: query });
          }}
        >
          <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="pb-q">
            Search name or UPC
          </label>
          <div className="flex gap-2">
            <input
              id="pb-q"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Marlboro or 028200336811"
              className="ft-input py-1.5 text-body-sm"
            />
            <button type="submit" className="ft-btn-secondary py-1.5">Go</button>
          </div>
        </form>

        <div>
          <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="pb-dept">
            Department
          </label>
          <select
            id="pb-dept"
            value={filter.dept ?? ""}
            onChange={(e) => pushFilter({ ...filter, dept: e.target.value || undefined })}
            className="ft-input py-1.5 text-body-sm min-w-[11rem]"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.name} value={d.name}>{d.name} ({d.count})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="pb-flag">
            Show
          </label>
          <select
            id="pb-flag"
            value={flag}
            onChange={(e) => {
              const v = e.target.value;
              pushFilter({
                ...filter,
                below: v === "below",
                noCost: v === "nocost",
                noPrice: v === "noprice",
              });
            }}
            className="ft-input py-1.5 text-body-sm min-w-[11rem]"
          >
            <option value="">Everything</option>
            <option value="nocost">Missing cost</option>
            <option value="noprice">Missing price</option>
            <option value="below">At or below cost{belowCostCount ? ` (${belowCostCount})` : ""}</option>
          </select>
        </div>

        {(filter.q || filter.dept || flag) && (
          <button
            onClick={() => { setQuery(""); pushFilter({}); }}
            className="ft-btn-ghost text-body-sm"
          >
            <Icon name="clear" className="text-[16px]" /> Clear
          </button>
        )}
        <div className="ml-auto text-body-sm text-on-surface-variant self-center tabular">
          {navigating ? "Loading…" : `${fmtNumber(matching)} items`}
        </div>
      </div>

      {/* Bulk bar */}
      {canEdit && (
        <Card className="p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2 text-body-sm font-semibold text-on-surface">
              <Icon name="sell" className="text-[20px] text-primary" />
              Bulk update
              <Badge tone={targetCount ? "info" : "neutral"}>{fmtNumber(targetCount)} selected</Badge>
            </div>
            <div>
              <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="pb-mode">Action</label>
              <select
                id="pb-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as BulkMode)}
                className="ft-input py-1.5 text-body-sm min-w-[9rem]"
              >
                {BULK_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="pb-value">
                {mode === "pct" ? "Percent" : "Amount"}
              </label>
              <input
                id="pb-value"
                type="number"
                step="0.01"
                min={mode === "set" ? 0 : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={mode === "pct" ? "5" : "1.99"}
                className="ft-input py-1.5 text-body-sm w-28"
              />
            </div>
            <div>
              <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="pb-round">Rounding</label>
              <select
                id="pb-round"
                value={rounding}
                onChange={(e) => setRounding(e.target.value as RoundRule)}
                className="ft-input py-1.5 text-body-sm min-w-[9rem]"
              >
                {ROUND_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <button onClick={onApply} disabled={!canApply} className="ft-btn-primary py-2">
              {busy ? "Applying…" : `Apply to ${fmtNumber(targetCount)}`}
            </button>
          </div>

          {busy && targetCount > 0 && (
            <div className="mt-3">
              <div className="h-2 rounded-full bg-surface-container-low overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.round((progress / Math.max(1, targetCount)) * 100)}%` }}
                />
              </div>
              <div className="text-body-sm text-on-surface-variant mt-1 tabular">
                {fmtNumber(progress)} / {fmtNumber(targetCount)}
              </div>
            </div>
          )}

          <p className="text-body-sm text-on-surface-variant mt-2">
            {targetCount === 0
              ? "Tick products below, or select everything matching the current filter."
              : previewOn
              ? `New prices are previewed in the table. ${modeHint}`
              : modeHint}
          </p>

          {/* Select-all-matching affordance */}
          {matching > products.length && (
            <div className="mt-2 text-body-sm">
              {allMatching ? (
                <span className="text-on-surface">
                  All <strong>{fmtNumber(matching)}</strong> items matching this filter are selected.{" "}
                  <button onClick={() => setAllMatching(false)} className="text-primary underline">Clear</button>
                </span>
              ) : (
                <button onClick={() => { setAllMatching(true); setSelected(new Set()); }} className="text-primary underline">
                  Select all {fmtNumber(matching)} items matching this filter
                </button>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface flex items-center justify-between">
          <span>Price Book</span>
          <span className="text-body-sm font-normal text-on-surface-variant tabular">
            Page {page} of {pageCount}
          </span>
        </div>
        {products.length === 0 ? (
          <EmptyState icon="search_off" title="No matching products" hint="Try a different search, department or filter." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  {canEdit && (
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        aria-label="Select this page"
                        checked={allPageSelected || allMatching}
                        onChange={togglePage}
                        className="accent-primary w-4 h-4 align-middle"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">UPC</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  {previewOn && <th className="px-4 py-3 text-right">New Price</th>}
                  <th className="px-4 py-3 text-right">Margin</th>
                  {canEdit && <th className="px-4 py-3 w-10" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {products.map((p) => {
                  const m = marginPct(p.currentCost, p.sellingPrice);
                  const below = isBelowCost(p.currentCost, p.sellingPrice);
                  const next = preview.get(p.id);
                  return (
                    <tr key={p.id} className="hover:bg-surface-container-low/50">
                      {canEdit && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${p.name}`}
                            checked={allMatching || selected.has(p.id)}
                            onChange={() => toggle(p.id)}
                            className="accent-primary w-4 h-4 align-middle"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">
                        {p.department ?? <span className="opacity-60">—</span>}
                      </td>
                      <td className="px-4 py-3 font-medium text-on-surface">
                        <span className="flex items-center gap-2">
                          {p.name}
                          {p.sellingPrice === 0 && <Badge tone="warning">No price</Badge>}
                          {below && <Badge tone="error">Below cost</Badge>}
                        </span>
                        {p.size && <span className="block text-body-sm text-on-surface-variant">{p.size}</span>}
                      </td>
                      <td className="px-4 py-3 tabular text-on-surface-variant whitespace-nowrap">{p.upc ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular">
                        {p.currentCost > 0 ? fmtMoney(p.currentCost) : <span className="text-on-surface-variant opacity-60">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular">{fmtMoney(p.sellingPrice)}</td>
                      {previewOn && (
                        <td className="px-4 py-3 text-right tabular font-semibold">
                          {next === undefined ? (
                            <span className="text-on-surface-variant">—</span>
                          ) : (
                            <span className={next >= p.sellingPrice ? "text-secondary" : "text-error"}>
                              {fmtMoney(next)}
                            </span>
                          )}
                        </td>
                      )}
                      <td className={`px-4 py-3 text-right tabular ${below ? "text-error font-semibold" : ""}`}>
                        {fmtMargin(m)}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setEditing(p)}
                            aria-label={`Edit price for ${p.name}`}
                            className="ft-btn-ghost p-1.5 rounded-full"
                          >
                            <Icon name="edit" className="text-[18px]" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pager */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-outline-variant/60">
            <span className="text-body-sm text-on-surface-variant tabular">
              {fmtNumber((page - 1) * pageSize + 1)}–{fmtNumber(Math.min(page * pageSize, matching))} of {fmtNumber(matching)}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || navigating}
                className="ft-btn-secondary py-1.5 disabled:opacity-50"
              >
                <Icon name="chevron_left" className="text-[18px]" /> Prev
              </button>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= pageCount || navigating}
                className="ft-btn-secondary py-1.5 disabled:opacity-50"
              >
                Next <Icon name="chevron_right" className="text-[18px]" />
              </button>
            </div>
          </div>
        )}
      </Card>

      {editing && <EditPriceModal product={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditPriceModal({ product, onClose }: { product: PriceRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateProductPricing, {});
  const [cost, setCost] = useState(String(product.currentCost));
  const [price, setPrice] = useState(String(product.sellingPrice));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (state?.ok) closeRef.current();
  }, [state]);

  const m = marginPct(Number(cost) || 0, Number(price) || 0);

  return (
    <Modal title={product.name} onClose={onClose}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="productId" value={product.id} readOnly />
        <div className="text-body-sm text-on-surface-variant">
          {product.department ?? "No department"}
          {product.upc && <> · UPC <span className="tabular">{product.upc}</span></>}
          {" · "}
          <Badge tone="info">{catLabel(product.category)}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="ep-cost">Unit cost</label>
            <input
              id="ep-cost" name="currentCost" type="number" step="0.01" min="0"
              value={cost} onChange={(e) => setCost(e.target.value)} className="ft-input" required
            />
          </div>
          <div>
            <label className="ft-label" htmlFor="ep-price">Selling price</label>
            <input
              id="ep-price" name="sellingPrice" type="number" step="0.01" min="0"
              value={price} onChange={(e) => setPrice(e.target.value)} className="ft-input" required
            />
          </div>
        </div>
        <p className="text-body-sm text-on-surface-variant">
          Margin at this price: <span className="tabular font-semibold text-on-surface">{fmtMargin(m)}</span>
        </p>

        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">
            {pending ? "Saving…" : "Save price"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
