"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";

function shift(dateISO: string, days: number): string {
  const d = new Date(dateISO + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Previous / next day + date picker that drives the ?date= query param. */
export default function DayNav({ date }: { date: string }) {
  const router = useRouter();
  const go = (d: string) => router.push(`/daily?date=${d}`);

  return (
    <div className="flex items-center gap-2 bg-surface-container-lowest border border-outline-variant/60 rounded-lg p-1.5 shadow-card">
      <button onClick={() => go(shift(date, -1))} className="ft-btn-ghost p-1.5 rounded-md" aria-label="Previous day">
        <Icon name="chevron_left" className="text-[20px]" />
      </button>
      <span className="flex items-center gap-2 px-1">
        <Icon name="calendar_today" className="text-[18px] text-on-surface-variant" />
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && go(e.target.value)}
          className="bg-transparent text-body-md font-semibold text-on-surface focus:outline-none"
        />
      </span>
      <button onClick={() => go(shift(date, 1))} className="ft-btn-ghost p-1.5 rounded-md" aria-label="Next day">
        <Icon name="chevron_right" className="text-[20px]" />
      </button>
    </div>
  );
}
