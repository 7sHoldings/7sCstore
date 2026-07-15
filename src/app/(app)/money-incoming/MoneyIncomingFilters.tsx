"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui";

const PRESETS: { key: string; label: string }[] = [
  { key: "mtd", label: "This Month" },
  { key: "lastmonth", label: "Last Month" },
];

const TYPES: { key: string; label: string }[] = [
  { key: "rent", label: "Rent" },
  { key: "gameMachine", label: "Game Machine" },
  { key: "stagityInvestment", label: "Stagity Investment" },
  { key: "beer", label: "Beer" },
];

/**
 * Money Incoming filter bar: This Month / Last Month presets, a custom date
 * range, and an income-type dropdown (Rent / Game Machine / Stagity
 * Investment / Beer) that narrows the list to entries with that income.
 */
export default function MoneyIncomingFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const period = params.get("period") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const type = params.get("type") ?? "";

  function setMany(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    router.refresh(); // bypass the client router cache so filtered data loads immediately
  }

  const hasFilters = Boolean(period || from || to || type);

  const btn = (active: boolean) =>
    `px-3 py-1.5 rounded text-body-sm font-semibold transition-colors ${active ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-primary"}`;

  return (
    <div className="flex flex-wrap items-end gap-3 mb-4 bg-surface-container-low border border-outline-variant/60 rounded-lg p-3">
      <div>
        <label className="text-label-caps uppercase text-on-surface-variant block mb-1">Period</label>
        <div className="inline-flex items-center bg-surface-container-lowest rounded-lg p-0.5 border border-outline-variant/60">
          {PRESETS.map((p) => (
            <button key={p.key} className={btn(period === p.key)} onClick={() => setMany({ period: period === p.key ? "" : p.key, from: "", to: "" })}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-label-caps uppercase text-on-surface-variant block mb-1">From</label>
        <input type="date" value={from} onChange={(e) => setMany({ from: e.target.value, period: "" })} className="ft-input py-1.5 text-body-sm" />
      </div>
      <div>
        <label className="text-label-caps uppercase text-on-surface-variant block mb-1">To</label>
        <input type="date" value={to} onChange={(e) => setMany({ to: e.target.value, period: "" })} className="ft-input py-1.5 text-body-sm" />
      </div>
      <div>
        <label className="text-label-caps uppercase text-on-surface-variant block mb-1">Income type</label>
        <select value={type} onChange={(e) => setMany({ type: e.target.value })} className="ft-input py-1.5 text-body-sm min-w-[10rem]">
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>
      {hasFilters && (
        <button onClick={() => { router.push(pathname); router.refresh(); }} className="ft-btn-ghost text-body-sm">
          <Icon name="clear" className="text-[16px]" /> Clear
        </button>
      )}
    </div>
  );
}
