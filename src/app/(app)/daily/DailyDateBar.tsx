"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function shift(dateISO: string, days: number): string {
  const d = new Date(dateISO + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Daily Sales date toolbar: Today / Yesterday presets, a day stepper, and a custom range. */
export default function DailyDateBar({
  date, isRange, from, to,
}: {
  date: string;
  isRange: boolean;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const goDay = (d: string) => router.push(`/daily?date=${d}`);
  const today = todayISO();
  const yesterday = shift(today, -1);
  const [f, setF] = useState(from ?? "");
  const [t, setT] = useState(to ?? "");
  const applyRange = () => { if (f && t) router.push(`/daily?from=${f}&to=${t}`); };

  const preset = (active: boolean) =>
    `px-3 py-1.5 rounded text-body-sm font-semibold transition-colors ${active ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-primary"}`;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6 no-print">
      <div className="inline-flex items-center bg-surface-container-low rounded-lg p-0.5 border border-outline-variant/60">
        <button className={preset(!isRange && date === today)} onClick={() => goDay(today)}>Today</button>
        <button className={preset(!isRange && date === yesterday)} onClick={() => goDay(yesterday)}>Yesterday</button>
      </div>

      <div className="inline-flex items-center gap-1 bg-surface-container-lowest border border-outline-variant/60 rounded-lg p-1">
        <button onClick={() => goDay(shift(date, -1))} className="ft-btn-ghost p-1.5 rounded-md" aria-label="Previous day">
          <Icon name="chevron_left" className="text-[20px]" />
        </button>
        <span className="inline-flex items-center gap-1.5 px-1">
          <Icon name="calendar_today" className="text-[18px] text-on-surface-variant" />
          <input
            type="date"
            value={isRange ? "" : date}
            onChange={(e) => e.target.value && goDay(e.target.value)}
            className="bg-transparent text-body-sm font-semibold text-on-surface focus:outline-none"
          />
        </span>
        <button onClick={() => goDay(shift(date, 1))} className="ft-btn-ghost p-1.5 rounded-md" aria-label="Next day">
          <Icon name="chevron_right" className="text-[20px]" />
        </button>
      </div>

      <div className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 border ${isRange ? "border-primary/50 bg-primary/[0.06]" : "border-outline-variant/60 bg-surface-container-low"}`}>
        <input type="date" value={f} onChange={(e) => setF(e.target.value)} className="bg-transparent text-body-sm focus:outline-none" aria-label="From" />
        <span className="text-on-surface-variant">→</span>
        <input type="date" value={t} onChange={(e) => setT(e.target.value)} className="bg-transparent text-body-sm focus:outline-none" aria-label="To" />
        <button onClick={applyRange} disabled={!f || !t} className="ft-btn-primary py-1 px-2.5 text-body-sm disabled:opacity-50">
          <Icon name="search" className="text-[16px]" /> Range
        </button>
      </div>
    </div>
  );
}
