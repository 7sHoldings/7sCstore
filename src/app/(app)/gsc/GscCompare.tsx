"use client";

import { useState } from "react";
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

/**
 * Which price a row will be set to.
 *
 * "auto" is the house rule — the greatest of our price, GSC's SRP and the
 * margin target — and stays the default for every row, so doing nothing keeps
 * the behaviour that was there before. The rest are deliberate overrides for
 * the cases the rule gets wrong: a slow mover you want left at SRP, a line
 * where the margin target reads too high for the shelf, a one-off number.
 */
type PriceChoice = "auto" | "current" | "srp" | "target" | "custom";

/** Used by the bulk "set selected to" control, which is not a per-row choice. */
const CHOICE_OPTIONS: { value: PriceChoice; label: string }[] = [
  { value: "auto", label: "Highest (default)" },
  { value: "target", label: "Margin target" },
  { value: "srp", label: "GSC SRP" },
  { value: "current", label: "Keep our price" },
];

const CHOICE_LABEL: Record<PriceChoice, string> = {
  auto: "highest",
  current: "kept ours",
  srp: "GSC SRP",
  target: "margin",
  custom: "your price",
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

/**
 * One candidate price with a box beside it. The three are mutually exclusive —
 * a row is priced at one number — so ticking one moves the tick rather than
 * adding to it. Checkboxes rather than radios because that is how the owner
 * reads the screen: tick the price you want.
 *
 * A price of zero is not a candidate (no SRP on the order, no price in the POS),
 * so it shows a dash with nothing to tick.
 */
function PricePick({
  value, ticked, onPick, enabled, label, decimals = 2,
}: {
  value: number | null;
  ticked: boolean;
  onPick: () => void;
  enabled: boolean;
  label: string;
  decimals?: number;
}) {
  if (value == null || value <= 0) {
    return <span className="opacity-50 tabular">—</span>;
  }
  const text = decimals === 2 ? fmtMoney(value) : `$${value.toFixed(decimals)}`;
  if (!enabled) return <span className="tabular">{text}</span>;

  return (
    <label
      className={`inline-flex items-center justify-end gap-1.5 cursor-pointer rounded px-1 -mx-1 py-0.5 hover:bg-surface-container ${
        ticked ? "font-semibold text-on-surface" : "text-on-surface-variant"
      }`}
    >
      <input
        type="checkbox"
        checked={ticked}
        onChange={onPick}
        aria-label={label}
        className="accent-primary w-4 h-4 shrink-0"
      />
      <span className="tabular">{text}</span>
    </label>
  );
}

/** The price a row lands on, and what that does to the shelf. */
function PriceOutcome({ price, delta, note }: { price: number; delta: number; note: string }) {
  if (!(price > 0)) {
    return <span className="text-body-sm text-on-surface-variant">no price</span>;
  }
  const up = delta > 0.005;
  const down = delta < -0.005;
  return (
    <span className="text-right leading-tight">
      <span className={`tabular font-semibold ${up ? "text-secondary" : down ? "text-error" : "text-on-surface-variant"}`}>
        {fmtMoney(price)}
      </span>
      <span className="block text-body-sm text-on-surface-variant">
        {up && <span className="text-secondary">+{fmtMoney(delta)} · </span>}
        {down && <span className="text-error">−{fmtMoney(Math.abs(delta))} · </span>}
        {!up && !down && "no change · "}
        {note}
      </span>
    </span>
  );
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

  // Per-row overrides, keyed by scan code. Deliberately not persisted: this is
  // a decision made while reviewing a page, and once applied the price itself
  // is the record.
  const [choice, setChoice] = useState<Record<string, PriceChoice>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});

  const choiceOf = (r: Row): PriceChoice => choice[r.upcNorm] ?? "auto";

  /**
   * Which box is ticked. Under "auto" that is whichever candidate the
   * max-of-three rule already picked, so the row opens with the default
   * visibly selected rather than with nothing chosen.
   */
  const tickedOn = (r: Row): PriceChoice => {
    const c = choiceOf(r);
    return c === "auto" ? r.priceSource : c;
  };

  /** Tick a price. Ticking the one already in use hands the row back to the default. */
  function pickPrice(r: Row, which: PriceChoice) {
    setChoice((prev) => ({
      ...prev,
      [r.upcNorm]: choiceOf(r) === which ? "auto" : which,
    }));
  }

  /** The price this row will be set to under its current choice. */
  function priceFor(r: Row): number {
    switch (choiceOf(r)) {
      case "current":
        return r.currentPrice ?? 0;
      case "srp":
        return r.srp;
      case "target":
        return r.targetPrice;
      case "custom": {
        const n = Number(typed[r.upcNorm]);
        return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
      }
      default:
        return r.finalPrice;
    }
  }

  /** What applying this row would do to the shelf price. */
  function deltaFor(r: Row): number {
    return Math.round((priceFor(r) - (r.currentPrice ?? 0)) * 100) / 100;
  }

  /**
   * A row can be applied when it has a product and its chosen price actually
   * differs from the shelf. Under "auto" that means a raise, as before; an
   * explicit choice may also LOWER a price, which is the point of the option —
   * so it is allowed, and called out in the row and above the button.
   */
  function canApply(r: Row): boolean {
    return Boolean(canEdit && r.productId && priceFor(r) > 0 && Math.abs(deltaFor(r)) > 0.005);
  }

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

  // Rows that have a product and a chosen price different from the shelf.
  const raisable = rows.filter(canApply);
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

  /** Set the same choice on every selected row — 100 dropdowns by hand is not a workflow. */
  function setChoiceForSelected(next: PriceChoice) {
    const keys = rows.filter((r) => r.productId && selected.has(r.productId)).map((r) => r.upcNorm);
    if (keys.length === 0) return;
    setChoice((prev) => {
      const out = { ...prev };
      for (const k of keys) out[k] = next;
      return out;
    });
  }

  async function onApply() {
    const items = rows
      .filter((r) => r.productId && selected.has(r.productId) && canApply(r))
      .map((r) => ({ productId: r.productId!, newPrice: priceFor(r) }));
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

  const chosenRows = rows.filter((r) => r.productId && selected.has(r.productId) && canApply(r));
  const selCount = chosenRows.length;
  const loweringCount = chosenRows.filter((r) => deltaFor(r) < 0).length;

  return (
    <div>
      {result && (
        <Banner tone="success" icon="check_circle">
          Updated {fmtNumber(result.updated)} price{result.updated === 1 ? "" : "s"}.
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
              Apply prices
              <Badge tone={selCount ? "info" : "neutral"}>{fmtNumber(selCount)} selected</Badge>
            </span>
            <button onClick={onApply} disabled={!selCount || busy} className="ft-btn-primary py-2">
              {busy ? "Applying…" : `Apply ${fmtNumber(selCount)} price${selCount === 1 ? "" : "s"}`}
            </button>

            <label className="flex items-center gap-2 text-body-sm text-on-surface-variant">
              Set selected to
              <select
                value=""
                disabled={selCount === 0 || busy}
                onChange={(e) => {
                  if (e.target.value) setChoiceForSelected(e.target.value as PriceChoice);
                  e.target.value = "";
                }}
                className="ft-input py-1.5 text-body-sm min-w-[11rem] disabled:opacity-50"
              >
                <option value="">Choose…</option>
                {CHOICE_OPTIONS.filter((o) => o.value !== "custom").map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>

            <span className="text-body-sm text-on-surface-variant">
              Each row opens with the greatest of <strong>Our Price</strong>, <strong>GSC SRP</strong>{" "}
              and <strong>Target</strong> already ticked. Tick a different one to use it instead, or
              tick <strong>my price</strong> to type your own. The box on the left is what gets
              applied.
            </span>
          </div>

          {loweringCount > 0 && (
            <p className="mt-2 text-body-sm text-error flex items-start gap-1.5">
              <Icon name="warning" className="text-[16px] mt-0.5 shrink-0" />
              {fmtNumber(loweringCount)} of these would <strong>lower</strong> a shelf price. That
              only happens because you picked it — the default never lowers anything.
            </p>
          )}
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
            hint={
              view === "raise"
                ? "No item is below its SRP or its margin target. Switch to All to set a different price on any item."
                : "Try a different filter."
            }
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
                  <th className="px-3 py-3 text-right whitespace-nowrap">New Price</th>
                  <th className="px-3 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {rows.map((r) => {
                  const pick = choiceOf(r);
                  const on = tickedOn(r);
                  const pickable = Boolean(canEdit && r.productId);
                  const price = priceFor(r);
                  const delta = deltaFor(r);
                  const canPick = canApply(r);
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
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <PricePick
                          value={r.currentPrice}
                          ticked={on === "current"}
                          onPick={() => pickPrice(r, "current")}
                          enabled={pickable}
                          label={`Keep our price for ${r.productName ?? r.description}`}
                        />
                      </td>
                      <td className="px-3 py-3 text-right tabular">{fmtMoney(r.caseCost)}</td>
                      <td className="px-3 py-3 text-right tabular text-on-surface-variant whitespace-nowrap">
                        {fmtNumber(r.unitsPerCase)}
                        {r.sizeLabel && <span className="opacity-60"> / {r.sizeLabel}</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular">${r.unitCost.toFixed(4)}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <PricePick
                          value={r.srp}
                          ticked={on === "srp"}
                          onPick={() => pickPrice(r, "srp")}
                          enabled={pickable}
                          label={`Use GSC SRP for ${r.productName ?? r.description}`}
                        />
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <PricePick
                          value={r.targetPrice}
                          ticked={on === "target"}
                          onPick={() => pickPrice(r, "target")}
                          enabled={pickable}
                          label={`Use the ${r.marginPct}% margin target for ${r.productName ?? r.description}`}
                        />
                      </td>
                      <td className="px-3 py-3 text-right">
                        {pickable ? (
                          <div className="flex flex-col items-end gap-1">
                            <PriceOutcome
                              price={price}
                              delta={delta}
                              note={pick === "auto" ? SOURCE_LABEL[r.priceSource] : CHOICE_LABEL[pick]}
                            />
                            <label className="inline-flex items-center gap-1.5 cursor-pointer text-body-sm text-on-surface-variant">
                              <input
                                type="checkbox"
                                checked={pick === "custom"}
                                onChange={() => pickPrice(r, "custom")}
                                aria-label={`Type my own price for ${r.productName ?? r.description}`}
                                className="accent-primary w-4 h-4 shrink-0"
                              />
                              my price
                            </label>
                            {pick === "custom" && (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                autoFocus
                                value={typed[r.upcNorm] ?? ""}
                                placeholder={r.finalPrice.toFixed(2)}
                                onChange={(e) =>
                                  setTyped((prev) => ({ ...prev, [r.upcNorm]: e.target.value }))
                                }
                                className="ft-input py-1 text-body-sm w-24 text-right tabular"
                              />
                            )}
                          </div>
                        ) : (
                          <div className="tabular font-semibold">
                            <span className={r.needsRaise ? "text-secondary" : "text-on-surface-variant"}>
                              {fmtMoney(r.finalPrice)}
                            </span>
                            <span className="block text-body-sm text-on-surface-variant">
                              {r.needsRaise
                                ? `+${fmtMoney(r.increase)} · ${SOURCE_LABEL[r.priceSource]}`
                                : "no change"}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          {r.unmatched ? (
                            <Badge tone="neutral">No product</Badge>
                          ) : delta > 0.005 ? (
                            <Badge tone="warning">Raise</Badge>
                          ) : delta < -0.005 ? (
                            <Badge tone="error">Lower</Badge>
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
