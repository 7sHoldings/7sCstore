"use client";

import { fmtMoney } from "@/lib/format";

/** Stacked daily bar chart: fuel vs store (FR-7). Pure SVG, no chart lib. */
export function TrendChart({
  data,
}: {
  data: { date: string; fuel: number; store: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-on-surface-variant text-body-sm">
        No data for this period
      </div>
    );
  }
  const max = Math.max(1, ...data.map((d) => d.fuel + d.store));
  const showLabels = data.length <= 14;

  return (
    <div>
      <div className="flex items-end gap-1 h-56">
        {data.map((d, i) => {
          const total = d.fuel + d.store;
          const fuelH = (d.fuel / max) * 100;
          const storeH = (d.store / max) * 100;
          return (
            <div key={i} className="flex-1 flex flex-col justify-end group relative h-full min-w-[3px]">
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full opacity-0 group-hover:opacity-100 transition-opacity bg-inverse-surface text-inverse-on-surface text-[10px] rounded px-2 py-1 whitespace-nowrap z-10 pointer-events-none">
                {d.date}: {fmtMoney(total)}
              </div>
              <div
                className="w-full bg-secondary-container rounded-t-sm"
                style={{ height: `${storeH}%` }}
              />
              <div
                className="w-full bg-primary"
                style={{ height: `${fuelH}%` }}
              />
            </div>
          );
        })}
      </div>
      {showLabels && (
        <div className="flex gap-1 mt-2">
          {data.map((d, i) => (
            <div key={i} className="flex-1 text-center text-[10px] text-on-surface-variant">
              {new Date(d.date).toLocaleDateString("en-US", { day: "numeric" })}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-4 mt-3 justify-center">
        <Legend color="bg-primary" label="Fuel" />
        <Legend color="bg-secondary-container" label="Store" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-body-sm text-on-surface-variant">
      <span className={`w-3 h-3 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

/** Donut showing fuel vs store revenue mix. */
export function DonutChart({
  fuel,
  store,
}: {
  fuel: number;
  store: number;
}) {
  const total = fuel + store;
  const fuelPct = total > 0 ? (fuel / total) * 100 : 0;
  const circ = 2 * Math.PI * 40;
  const fuelDash = (fuelPct / 100) * circ;

  return (
    <div className="relative w-40 h-40 mx-auto">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#6cf8bb" strokeWidth="14" />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="#0a2540"
          strokeWidth="14"
          strokeDasharray={`${fuelDash} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-2xl font-bold text-primary">{Math.round(fuelPct)}%</span>
        <span className="text-label-caps uppercase text-on-surface-variant">Fuel</span>
      </div>
    </div>
  );
}

/** Horizontal proportion bars for category breakdowns. */
export function CategoryBars({
  items,
}: {
  items: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.label}>
          <div className="flex justify-between text-body-sm mb-1">
            <span className="text-on-surface">{it.label}</span>
            <span className="tabular font-semibold text-on-surface">{fmtMoney(it.value)}</span>
          </div>
          <div className="h-2 bg-surface-container rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full"
              style={{ width: `${(it.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
