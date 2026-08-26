"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
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
import { bulkUpdatePrices, updateProductPricing } from "./actions";

export interface PriceRow {
  id: string;
  name: string;
  category: string;
  currentCost: number;
  sellingPrice: number;
  qtyOnHand: number;
}

export default function PriceBook({
  products,
  canEdit,
}: {
  products: PriceRow[];
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<PriceRow | null>(null);

  // Bulk controls. `value` stays a string so the input can be empty or "-".
  const [mode, setMode] = useState<BulkMode>("pct");
  const [value, setValue] = useState("");
  const [rounding, setRounding] = useState<RoundRule>("none");

  const [state, action, pending] = useActionState(bulkUpdatePrices, {});

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category))].sort(),
    [products]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) => (!cat || p.category === cat) && (!q || p.name.toLowerCase().includes(q))
    );
  }, [products, query, cat]);

  // Only selections that are still on screen can be repriced, so the count in
  // the bulk bar always matches what the user can see.
  const selectedVisible = useMemo(
    () => visible.filter((p) => selected.has(p.id)),
    [visible, selected]
  );

  const numeric = value.trim() === "" ? null : Number(value);
  const previewOn =
    numeric !== null && isFinite(numeric) && selectedVisible.length > 0;

  const preview = useMemo(() => {
    const map = new Map<string, number>();
    if (!previewOn) return map;
    for (const p of selectedVisible) {
      map.set(p.id, applyBulkPrice(p.sellingPrice, mode, numeric!, rounding));
    }
    return map;
  }, [previewOn, selectedVisible, mode, numeric, rounding]);

  // Clear the selection once a bulk change lands so the next one starts clean.
  useEffect(() => {
    if (state?.ok) {
      setSelected(new Set());
      setValue("");
    }
  }, [state]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const allOn = visible.length > 0 && visible.every((p) => selected.has(p.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of visible) {
        if (allOn) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));
  const modeHint = BULK_MODES.find((m) => m.value === mode)?.hint;

  return (
    <div>
      {state?.ok && (
        <Banner tone={state.updated ? "success" : "info"} icon={state.updated ? "check_circle" : "info"}>
          {state.updated
            ? `Updated ${state.updated} ${state.updated === 1 ? "price" : "prices"}.`
            : "No prices changed — the new prices matched the current ones."}
        </Banner>
      )}
      {state?.error && (
        <Banner tone="error" icon="error">{state.error}</Banner>
      )}

      {/* Search + category filter */}
      <div className="flex flex-wrap items-end gap-3 mb-4 bg-surface-container-low border border-outline-variant/60 rounded-lg p-3">
        <div className="flex-1 min-w-[12rem]">
          <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="pb-q">
            Search
          </label>
          <input
            id="pb-q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Product name…"
            className="ft-input py-1.5 text-body-sm"
          />
        </div>
        <div>
          <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="pb-cat">
            Category
          </label>
          <select
            id="pb-cat"
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="ft-input py-1.5 text-body-sm min-w-[9rem]"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>{catLabel(c)}</option>
            ))}
          </select>
        </div>
        {(query || cat) && (
          <button onClick={() => { setQuery(""); setCat(""); }} className="ft-btn-ghost text-body-sm">
            <Icon name="clear" className="text-[16px]" /> Clear
          </button>
        )}
        <div className="ml-auto text-body-sm text-on-surface-variant self-center">
          {visible.length} of {products.length} products
        </div>
      </div>

      {/* Bulk update bar */}
      {canEdit && (
        <form action={action}>
          <input type="hidden" name="ids" value={selectedVisible.map((p) => p.id).join(",")} readOnly />
          <Card className="p-4 mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-2 text-body-sm font-semibold text-on-surface">
                <Icon name="sell" className="text-[20px] text-primary" />
                Bulk update
                <Badge tone={selectedVisible.length ? "info" : "neutral"}>
                  {selectedVisible.length} selected
                </Badge>
              </div>
              <div>
                <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="pb-mode">
                  Action
                </label>
                <select
                  id="pb-mode"
                  name="mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as BulkMode)}
                  className="ft-input py-1.5 text-body-sm min-w-[9rem]"
                >
                  {BULK_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="pb-value">
                  {mode === "pct" ? "Percent" : "Amount"}
                </label>
                <input
                  id="pb-value"
                  name="value"
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
                <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="pb-round">
                  Rounding
                </label>
                <select
                  id="pb-round"
                  name="rounding"
                  value={rounding}
                  onChange={(e) => setRounding(e.target.value as RoundRule)}
                  className="ft-input py-1.5 text-body-sm min-w-[9rem]"
                >
                  {ROUND_RULES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={pending || !previewOn}
                className="ft-btn-primary py-2 disabled:opacity-60"
              >
                {pending ? "Applying…" : `Apply to ${selectedVisible.length}`}
              </button>
            </div>
            <p className="text-body-sm text-on-surface-variant mt-2">
              {selectedVisible.length === 0
                ? "Select products below to reprice them together."
                : previewOn
                ? `New prices are previewed in the table. ${modeHint}`
                : modeHint}
            </p>
          </Card>
        </form>
      )}

      {/* Price book */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">
          Price Book
        </div>
        {visible.length === 0 ? (
          <EmptyState icon="search_off" title="No matching products" hint="Try a different search or category." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  {canEdit && (
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all shown"
                        checked={allVisibleSelected}
                        onChange={toggleAll}
                        className="accent-primary w-4 h-4 align-middle"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-right">On Hand</th>
                  <th className="px-4 py-3 text-right">Unit Cost</th>
                  <th className="px-4 py-3 text-right">Sell Price</th>
                  {previewOn && <th className="px-4 py-3 text-right">New Price</th>}
                  <th className="px-4 py-3 text-right">Margin</th>
                  {canEdit && <th className="px-4 py-3 w-10" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {visible.map((p) => {
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
                            checked={selected.has(p.id)}
                            onChange={() => toggle(p.id)}
                            className="accent-primary w-4 h-4 align-middle"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 font-medium text-on-surface">
                        <span className="flex items-center gap-2">
                          {p.name}
                          {p.sellingPrice === 0 && <Badge tone="warning">No price</Badge>}
                          {below && <Badge tone="error">Below cost</Badge>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">{catLabel(p.category)}</td>
                      <td className="px-4 py-3 text-right tabular">{fmtNumber(p.qtyOnHand)}</td>
                      <td className="px-4 py-3 text-right tabular">{fmtMoney(p.currentCost)}</td>
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
    <Modal title={`Price — ${product.name}`} onClose={onClose}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="productId" value={product.id} readOnly />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="ep-cost">Unit cost</label>
            <input
              id="ep-cost"
              name="currentCost"
              type="number"
              step="0.01"
              min="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="ft-input"
              required
            />
          </div>
          <div>
            <label className="ft-label" htmlFor="ep-price">Selling price</label>
            <input
              id="ep-price"
              name="sellingPrice"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="ft-input"
              required
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
