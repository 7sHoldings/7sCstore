"use client";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

/**
 * Filters for the Monthly Summary. Every change updates the URL so a view can
 * be bookmarked or shared:
 *   All months:  ?from=YYYY-MM&month=YYYY-MM            (any range, up to 24 months)
 *   Compare:     ?view=compare&month=YYYY-MM&vs=prev|lastyear|custom&b=YYYY-MM&full=1
 */
type View = "months" | "compare";
type Vs = "prev" | "lastyear" | "custom";

const shift = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const label = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export default function SummaryFilter({
  month, from, vs, b, full, running, view, thisMonth,
}: {
  month: string; // the selected (last) month
  from: string; // first month shown in All months
  vs: Vs;
  b: string; // the month being compared with (resolved)
  full: boolean;
  running: boolean;
  view: View;
  thisMonth: string; // the store's current month
}) {
  const router = useRouter();
  const path = usePathname();
  const [state, setState] = useState({ month, from, vs, b, full, view });

  const go = (next: Partial<typeof state>) => {
    const s = { ...state, ...next };
    if (s.from > s.month) s.from = s.month;
    setState(s);
    const q = new URLSearchParams({ month: s.month });
    if (s.view === "compare") {
      q.set("view", "compare");
      q.set("vs", s.vs);
      if (s.vs === "custom" && s.b) q.set("b", s.b);
      if (s.full) q.set("full", "1");
    } else if (s.from !== `${s.month.slice(0, 4)}-01`) {
      q.set("from", s.from);
    }
    router.push(`${path}?${q.toString()}`);
  };

  const tab = (active: boolean) =>
    `flex-1 sm:flex-none px-4 py-2.5 rounded-lg text-body-sm font-semibold transition-colors whitespace-nowrap ${
      active ? "bg-primary text-on-primary shadow-sm" : "text-on-surface hover:bg-surface-container"
    }`;
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-body-sm font-medium border transition-colors whitespace-nowrap ${
      active ? "bg-primary text-on-primary border-primary" : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container"
    }`;
  const input = "h-10 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface";
  const cap = "text-label-caps uppercase text-on-surface-variant";

  const viewTabs = (
    <div className="flex p-1 rounded-xl bg-surface-container-low border border-outline-variant/60 mb-4 w-full sm:w-max">
      <button type="button" className={tab(state.view === "months")} onClick={() => go({ view: "months" })}>
        Month by month
      </button>
      <button type="button" className={tab(state.view === "compare")} onClick={() => go({ view: "compare" })}>
        Compare 2 months
      </button>
    </div>
  );

  if (state.view === "months") {
    const presets: { label: string; from: string; month: string }[] = [
      { label: `This year`, from: `${thisMonth.slice(0, 4)}-01`, month: thisMonth },
      { label: "Last 12 months", from: shift(thisMonth, -11), month: thisMonth },
      { label: "Last 6 months", from: shift(thisMonth, -5), month: thisMonth },
      { label: "Last 3 months", from: shift(thisMonth, -2), month: thisMonth },
      { label: `Last year`, from: `${Number(thisMonth.slice(0, 4)) - 1}-01`, month: `${Number(thisMonth.slice(0, 4)) - 1}-12` },
    ];
    return (
      <div>
        {viewTabs}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={cap}>From</span>
            <input type="month" value={state.from} max={state.month} onChange={(e) => e.target.value && go({ from: e.target.value })} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={cap}>To</span>
            <input type="month" value={state.month} onChange={(e) => e.target.value && go({ month: e.target.value })} className={input} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {presets.map((p) => (
            <button key={p.label} type="button" className={chip(state.from === p.from && state.month === p.month)} onClick={() => go(p)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3 text-body-sm text-on-surface-variant flex flex-wrap items-center gap-2">
          <span>Compare one month with another:</span>
          <button type="button" className={chip(false)} onClick={() => go({ view: "compare", vs: "lastyear" })}>
            {label(state.month)} vs {label(shift(state.month, -12))}
          </button>
          <button type="button" className={chip(false)} onClick={() => go({ view: "compare", vs: "prev" })}>
            {label(state.month)} vs {label(shift(state.month, -1))}
          </button>
        </div>
      </div>
    );
  }

  // Always show the month actually being compared — never a stale pick.
  const bShown = state.vs === "custom" && state.b ? state.b : state.vs === "lastyear" ? shift(state.month, -12) : shift(state.month, -1);

  return (
    <div>
      {viewTabs}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={cap}>Month</span>
          <input type="month" value={state.month} onChange={(e) => e.target.value && go({ month: e.target.value })} className={input} />
        </label>
        <span className="pb-2.5 font-semibold text-on-surface-variant">vs</span>
        <label className="flex flex-col gap-1">
          <span className={cap}>Compare with</span>
          <input type="month" value={bShown} onChange={(e) => e.target.value && go({ vs: "custom", b: e.target.value })} className={input} />
        </label>
        {running && (
          <label className="flex items-center gap-2 text-body-sm text-on-surface pb-2.5 cursor-pointer">
            <input type="checkbox" checked={state.full} onChange={(e) => go({ full: e.target.checked })} className="w-4 h-4 accent-primary" />
            Compare full months
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className={chip(state.vs === "prev")} onClick={() => go({ vs: "prev" })}>
          Previous month · {label(shift(state.month, -1))}
        </button>
        <button type="button" className={chip(state.vs === "lastyear")} onClick={() => go({ vs: "lastyear" })}>
          Same month last year · {label(shift(state.month, -12))}
        </button>
      </div>
    </div>
  );
}
