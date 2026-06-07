"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Icon } from "./ui";

const OPTIONS: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "wtd", label: "Week" },
  { key: "mtd", label: "Month" },
  { key: "ytd", label: "Year" },
];

/** Segmented control that drives the `period` query param (FR-1, FR-11). */
export default function PeriodSelect({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function select(key: string) {
    const next = new URLSearchParams(params.toString());
    next.set("period", key);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="inline-flex items-center bg-surface-container-low rounded-md p-0.5 border border-outline-variant/60">
      <Icon name="calendar_today" className="text-[16px] text-on-surface-variant mx-2" />
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          onClick={() => select(o.key)}
          className={`px-3 py-1.5 rounded text-body-sm font-semibold transition-colors ${
            value === o.key
              ? "bg-primary text-on-primary"
              : "text-on-surface-variant hover:text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
