"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Icon } from "./ui";

export interface PeriodPreset { key: string; label: string }

const DEFAULT_PRESETS: PeriodPreset[] = [
  { key: "today", label: "Today" },
  { key: "yest", label: "Yesterday" },
  { key: "wtd", label: "Week" },
  { key: "mtd", label: "This Month" },
  { key: "lastmonth", label: "Last Month" },
  { key: "lastquarter", label: "Quarter" },
  { key: "ytd", label: "Year" },
];

/** Unified date selector: presets, an optional single-day picker, and a custom range. */
export default function PeriodBar({
  period, from, to, path, presets, showDay = true,
}: {
  period?: string;
  from?: string;
  to?: string;
  path?: string;
  presets?: PeriodPreset[];
  showDay?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const base = path || pathname;
  const [f, setF] = useState(from ?? "");
  const [t, setT] = useState(to ?? "");
  const isRange = Boolean(from && to);
  const isDay = isRange && from === to;
  const items = presets ?? DEFAULT_PRESETS;

  // router.refresh() after each push bypasses the client router cache so the
  // newly filtered data shows immediately (no manual page reload needed).
  const goPeriod = (k: string) => { router.push(`${base}?period=${k}`); router.refresh(); };
  const goRange = () => { if (f && t) { router.push(`${base}?from=${f}&to=${t}`); router.refresh(); } };
  const goDay = (d: string) => { if (d) { router.push(`${base}?from=${d}&to=${d}`); router.refresh(); } };

  const btn = (active: boolean) =>
    `px-3 py-1.5 rounded text-body-sm font-semibold transition-colors ${active ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-primary"}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center bg-surface-container-low rounded-lg p-0.5 border border-outline-variant/60">
        {items.map((p) => (
          <button key={p.key} className={btn(period === p.key && !isRange)} onClick={() => goPeriod(p.key)}>{p.label}</button>
        ))}
      </div>

      {showDay && (
        <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 border ${isDay ? "border-primary/50 bg-primary/[0.06]" : "border-outline-variant/60 bg-surface-container-lowest"}`}>
          <Icon name="event" className="text-[18px] text-on-surface-variant" />
          <input type="date" value={isDay ? (from ?? "") : ""} onChange={(e) => goDay(e.target.value)} className="bg-transparent text-body-sm focus:outline-none" aria-label="Pick a day" />
        </div>
      )}

      <div className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 border ${isRange && !isDay ? "border-primary/50 bg-primary/[0.06]" : "border-outline-variant/60 bg-surface-container-low"}`}>
        <input type="date" value={f} onChange={(e) => setF(e.target.value)} className="bg-transparent text-body-sm focus:outline-none" aria-label="From" />
        <span className="text-on-surface-variant">→</span>
        <input type="date" value={t} onChange={(e) => setT(e.target.value)} className="bg-transparent text-body-sm focus:outline-none" aria-label="To" />
        <button onClick={goRange} disabled={!f || !t} className="ft-btn-primary py-1 px-2.5 text-body-sm disabled:opacity-50">
          <Icon name="search" className="text-[16px]" /> Range
        </button>
      </div>
    </div>
  );
}
