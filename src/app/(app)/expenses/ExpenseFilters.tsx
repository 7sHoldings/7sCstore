"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui";
import { expenseCatLabel } from "@/lib/format";

const CATEGORIES = ["STORE_OPERATING_EXPENSES", "INVENTORY_PURCHASE"];
const PRESETS: { key: string; label: string }[] = [
  { key: "mtd", label: "This Month" },
  { key: "lastmonth", label: "Last Month" },
];

/**
 * Expenses filter bar: This Month / Last Month presets, a custom date range,
 * the category select, and a multi-select "Expense type" dropdown whose
 * options follow the chosen category (types for Store Operating Expenses,
 * vendors for Inventory Purchase). Everything writes to query params and
 * refreshes the page data immediately.
 */
export default function ExpenseFilters({
  operatingTypes,
  vendors,
}: {
  operatingTypes: string[];
  vendors: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const period = params.get("period") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const category = params.get("category") ?? "";
  const selectedTypes = useMemo(
    () => (params.get("types") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    [params]
  );

  // Options follow the category; with no category chosen, show both lists.
  const typeOptions = useMemo(() => {
    if (category === "STORE_OPERATING_EXPENSES") return operatingTypes;
    if (category === "INVENTORY_PURCHASE") return vendors;
    return [...operatingTypes, ...vendors.filter((v) => !operatingTypes.includes(v))];
  }, [category, operatingTypes, vendors]);

  function go(next: URLSearchParams) {
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    router.refresh(); // bypass the client router cache so filtered data loads immediately
  }

  function setMany(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    go(next);
  }

  const setPeriod = (k: string) => setMany({ period: period === k ? "" : k, from: "", to: "" });
  const setFrom = (v: string) => setMany({ from: v, period: "" });
  const setTo = (v: string) => setMany({ to: v, period: "" });
  const setCategory = (v: string) => {
    // Keep only the selected types that still belong to the new category's list.
    const nextOptions = v === "STORE_OPERATING_EXPENSES" ? operatingTypes : v === "INVENTORY_PURCHASE" ? vendors : null;
    const kept = nextOptions ? selectedTypes.filter((t) => nextOptions.includes(t)) : selectedTypes;
    setMany({ category: v, types: kept.join(",") });
  };
  const toggleType = (t: string) => {
    const next = selectedTypes.includes(t) ? selectedTypes.filter((x) => x !== t) : [...selectedTypes, t];
    setMany({ types: next.join(",") });
  };

  const hasFilters = Boolean(period || from || to || category || selectedTypes.length);

  const btn = (active: boolean) =>
    `px-3 py-1.5 rounded text-body-sm font-semibold transition-colors ${active ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-primary"}`;

  return (
    <div className="flex flex-wrap items-end gap-3 mb-4 bg-surface-container-low border border-outline-variant/60 rounded-lg p-3">
      <div>
        <label className="text-label-caps uppercase text-on-surface-variant block mb-1">Period</label>
        <div className="inline-flex items-center bg-surface-container-lowest rounded-lg p-0.5 border border-outline-variant/60">
          {PRESETS.map((p) => (
            <button key={p.key} className={btn(period === p.key)} onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-label-caps uppercase text-on-surface-variant block mb-1">From</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ft-input py-1.5 text-body-sm" />
      </div>
      <div>
        <label className="text-label-caps uppercase text-on-surface-variant block mb-1">To</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ft-input py-1.5 text-body-sm" />
      </div>
      <div>
        <label className="text-label-caps uppercase text-on-surface-variant block mb-1">Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="ft-input py-1.5 text-body-sm min-w-[8rem]">
          <option value="">All</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{expenseCatLabel(c)}</option>
          ))}
        </select>
      </div>
      <TypeMultiSelect options={typeOptions} selected={selectedTypes} onToggle={toggleType} onClear={() => setMany({ types: "" })} />
      {hasFilters && (
        <button onClick={() => go(new URLSearchParams())} className="ft-btn-ghost text-body-sm">
          <Icon name="clear" className="text-[16px]" /> Clear
        </button>
      )}
    </div>
  );
}

/** Checkbox dropdown for picking any number of expense types / vendors. */
function TypeMultiSelect({
  options,
  selected,
  onToggle,
  onClear,
}: {
  options: string[];
  selected: string[];
  onToggle: (t: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const label = selected.length === 0 ? "All types" : selected.length === 1 ? selected[0] : `${selected.length} types`;

  return (
    <div className="relative" ref={boxRef}>
      <label className="text-label-caps uppercase text-on-surface-variant block mb-1">Expense type</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="ft-input py-1.5 text-body-sm min-w-[11rem] flex items-center justify-between gap-2 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{label}</span>
        <Icon name={open ? "arrow_drop_up" : "arrow_drop_down"} className="text-[20px] shrink-0" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-72 max-h-80 overflow-y-auto custom-scrollbar bg-surface-container-lowest border border-outline-variant/60 rounded-lg shadow-floating p-2">
          <div className="flex items-center justify-between px-2 pb-2 border-b border-outline-variant/40 mb-1">
            <span className="text-body-sm text-on-surface-variant">{selected.length} selected</span>
            {selected.length > 0 && (
              <button type="button" onClick={onClear} className="text-body-sm text-primary font-semibold">Clear</button>
            )}
          </div>
          {options.length === 0 ? (
            <div className="px-2 py-3 text-body-sm text-on-surface-variant">No options</div>
          ) : (
            options.map((o) => (
              <label key={o} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-container-low cursor-pointer text-body-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(o)}
                  onChange={() => onToggle(o)}
                  className="w-4 h-4 accent-[#0a2540]"
                />
                <span className="truncate">{o}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
