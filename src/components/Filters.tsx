"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Icon } from "./ui";

export interface SelectFilter {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}

/**
 * Date-range + select filters that write to query params (FR-11, FR-20, FR-34).
 * Server pages read the same params, so filters apply consistently everywhere.
 */
export default function Filters({
  selects = [],
  showDates = true,
}: {
  selects?: SelectFilter[];
  showDates?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    router.push(`${pathname}?${next.toString()}`);
  }

  const hasFilters =
    (showDates && (params.get("from") || params.get("to"))) ||
    selects.some((s) => params.get(s.name));

  return (
    <div className="flex flex-wrap items-end gap-3 mb-4 bg-surface-container-low border border-outline-variant/60 rounded-lg p-3">
      {showDates && (
        <>
          <div>
            <label className="text-label-caps uppercase text-on-surface-variant block mb-1">From</label>
            <input
              type="date"
              defaultValue={params.get("from") ?? ""}
              onChange={(e) => setParam("from", e.target.value)}
              className="ft-input py-1.5 text-body-sm"
            />
          </div>
          <div>
            <label className="text-label-caps uppercase text-on-surface-variant block mb-1">To</label>
            <input
              type="date"
              defaultValue={params.get("to") ?? ""}
              onChange={(e) => setParam("to", e.target.value)}
              className="ft-input py-1.5 text-body-sm"
            />
          </div>
        </>
      )}
      {selects.map((s) => (
        <div key={s.name}>
          <label className="text-label-caps uppercase text-on-surface-variant block mb-1">{s.label}</label>
          <select
            defaultValue={params.get(s.name) ?? ""}
            onChange={(e) => setParam(s.name, e.target.value)}
            className="ft-input py-1.5 text-body-sm min-w-[8rem]"
          >
            <option value="">All</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      ))}
      {hasFilters && (
        <button
          onClick={() => router.push(pathname)}
          className="ft-btn-ghost text-body-sm"
        >
          <Icon name="clear" className="text-[16px]" /> Clear
        </button>
      )}
    </div>
  );
}
