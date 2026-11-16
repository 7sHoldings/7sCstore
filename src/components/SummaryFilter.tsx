"use client";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

/**
 * Month + "compare with" picker for the Monthly Summary. Every change updates
 * the URL (?month=YYYY-MM&vs=prev|lastyear|custom&b=YYYY-MM&full=1) so a view
 * can be bookmarked or shared.
 */
export default function SummaryFilter({
  month, vs, b, full, running, prevLabel, lastYearLabel, view, yearLabel,
}: {
  month: string;
  vs: "prev" | "lastyear" | "custom";
  b: string;
  full: boolean;
  running: boolean;
  prevLabel: string;
  lastYearLabel: string;
  view: "months" | "compare";
  yearLabel: string; // e.g. "Jan – Nov 2026"
}) {
  const router = useRouter();
  const path = usePathname();
  const [state, setState] = useState({ month, vs, b, full, view });

  const go = (next: Partial<typeof state>) => {
    const s = { ...state, ...next };
    setState(s);
    const q = new URLSearchParams({ month: s.month, vs: s.vs });
    if (s.vs === "custom" && s.b) q.set("b", s.b);
    if (s.full) q.set("full", "1");
    if (s.view === "compare") q.set("view", "compare");
    router.push(`${path}?${q.toString()}`);
  };

  const tab = (active: boolean) =>
    `flex-1 sm:flex-none px-4 py-2.5 rounded-lg text-body-sm font-semibold transition-colors whitespace-nowrap ${
      active ? "bg-primary text-on-primary shadow-sm" : "text-on-surface hover:bg-surface-container"
    }`;
  const viewTabs = (
    <div className="flex p-1 rounded-xl bg-surface-container-low border border-outline-variant/60 mb-4 w-full sm:w-max">
      <button type="button" className={tab(state.view === "months")} onClick={() => go({ view: "months" })}>
        All months <span className="font-normal opacity-80">· {yearLabel}</span>
      </button>
      <button type="button" className={tab(state.view === "compare")} onClick={() => go({ view: "compare" })}>
        Compare 2 months
      </button>
    </div>
  );

  if (state.view === "months") {
    return (
      <div>
        {viewTabs}
        <label className="flex flex-col gap-1 w-max">
          <span className="text-label-caps uppercase text-on-surface-variant">Show January up to</span>
          <input
            type="month"
            value={state.month}
            onChange={(e) => e.target.value && go({ month: e.target.value })}
            className="h-10 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface"
          />
        </label>
      </div>
    );
  }

  const pill = (active: boolean) =>
    `px-3 py-2 rounded-lg text-body-sm font-medium border transition-colors whitespace-nowrap ${
      active
        ? "bg-primary text-on-primary border-primary"
        : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container"
    }`;

  return (
    <div>
    {viewTabs}
    <div className="flex flex-col lg:flex-row lg:items-end gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-label-caps uppercase text-on-surface-variant">Month</span>
        <input
          type="month"
          value={state.month}
          onChange={(e) => e.target.value && go({ month: e.target.value })}
          className="h-10 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface"
        />
      </label>

      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-label-caps uppercase text-on-surface-variant">Compare with</span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={pill(state.vs === "prev")} onClick={() => go({ vs: "prev" })}>
            Previous month <span className="opacity-75">· {prevLabel}</span>
          </button>
          <button type="button" className={pill(state.vs === "lastyear")} onClick={() => go({ vs: "lastyear" })}>
            Same month last year <span className="opacity-75">· {lastYearLabel}</span>
          </button>
          <span className={`${pill(state.vs === "custom")} inline-flex items-center gap-2 !py-1`}>
            <span onClick={() => state.b && go({ vs: "custom" })} className="cursor-pointer">Pick a month</span>
            <input
              type="month"
              value={state.b}
              onChange={(e) => e.target.value && go({ vs: "custom", b: e.target.value })}
              className="h-8 px-2 rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface"
              aria-label="Month to compare with"
            />
          </span>
        </div>
      </div>

      {running && (
        <label className="flex items-center gap-2 text-body-sm text-on-surface lg:pb-2.5 cursor-pointer">
          <input type="checkbox" checked={state.full} onChange={(e) => go({ full: e.target.checked })} className="w-4 h-4 accent-primary" />
          Compare full months
        </label>
      )}
    </div>
    </div>
  );
}
