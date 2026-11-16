"use client";
import { Fragment, ReactNode, useState } from "react";
import { delta, deltaPerDay, type Tone, type Unit } from "@/lib/compare";
import { Num, fmtCompact, fmtVal } from "@/components/num";

export interface GridMonth {
  ym: string;
  label: string;
  partial?: boolean; // running month — shown; coloured only for per-day rows
  days?: number; // days the numbers cover (31, 30, 28 — or days so far in the running month)
}
export interface GridRow {
  label: ReactNode;
  values: (number | null)[]; // one per month; null = no data for that month
  unit?: Unit;
  good?: boolean; // default true: higher is better
  neutral?: boolean; // never coloured
  strong?: boolean;
  indent?: boolean;
  noTotal?: boolean;
  /** Colour against a fixed target instead of the month before (e.g. gross profit ≥ 30%). */
  threshold?: number;
  /** Shown in the total column instead of the sum (e.g. a whole-period percentage). */
  totalValue?: number | null;
  section?: string; // header row before this one; tap it to fold the rows under it
  proj?: { current: number | null; next: number | null } | null;
  /** This row opens/closes the rows whose `group` matches (e.g. a subtotal and its payees). */
  groupHead?: string;
  /** Hidden while its group is closed. */
  group?: string;
  /** Per month: show "(x%)" of this value next to each number (e.g. share of total expenses). */
  pctBase?: (number | null)[];
  /** Colour on the DAILY AVERAGE (total ÷ days), so month length doesn't decide green/red. */
  perDay?: boolean;
}

const Share = ({ v, base }: { v: number; base: number | null | undefined }) =>
  base ? (
    <div className="text-[10px] leading-none font-normal text-on-surface-variant mt-0.5 pr-1.5" title="Share of total expenses">
      {Math.round((v / base) * 100)}%
    </div>
  ) : null;

const Chevron = ({ open }: { open: boolean }) => (
  <span
    aria-hidden
    className={`material-symbols-outlined text-[18px] align-[-4px] text-on-surface-variant transition-transform ${open ? "rotate-90" : ""}`}
  >
    chevron_right
  </span>
);

/**
 * Month-by-month grid with a year total and optional projected columns. Each
 * number is coloured on its own against the month before it.
 *
 * Long tables fold: a row with `groupHead` (e.g. "Store expenses") opens its
 * payees, closed to start; a `section` header folds everything under it.
 */
export function MonthGrid({
  months, rows, totalLabel = "Year total", projLabels,
}: {
  months: GridMonth[];
  rows: GridRow[];
  totalLabel?: string;
  projLabels?: { current: string | null; next: string } | null;
}) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [closedSections, setClosedSections] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    apply(n);
  };

  const showProj = !!projLabels && rows.some((r) => r.proj);
  const projCols = showProj ? (projLabels!.current ? 2 : 1) : 0;
  const projTh = "px-3 py-2.5 text-right whitespace-nowrap bg-tertiary-container/40 text-on-tertiary-container";
  const projTd = "px-3 py-2 text-right tabular whitespace-nowrap bg-tertiary-container/25 italic text-on-surface";
  // Narrow on phones (names wrap) so the month columns stay in view.
  const labelCls =
    "grid-label sticky left-0 z-[1] bg-surface-container-lowest px-3 sm:px-4 py-2 min-w-[7.5rem] max-w-[9.5rem] sm:max-w-[18rem] whitespace-normal leading-snug break-words";

  let section = "";
  return (
    <div className="overflow-x-auto">
      {months.length > 3 && (
        <div className="md:hidden px-4 pt-2 text-[11px] text-on-surface-variant flex items-center gap-1" data-noexport>
          <span className="material-symbols-outlined text-[14px]" aria-hidden>swipe</span> Swipe sideways to see every month
        </div>
      )}
      <table className="text-body-sm min-w-full">
        <thead>
          <tr className="text-label-caps uppercase text-on-surface-variant border-b border-outline-variant/50">
            <th className={labelCls.replace("py-2", "py-2.5")} />
            {months.map((m) => (
              <th key={m.ym} className="px-2 py-2.5 text-right whitespace-nowrap">
                {m.label}
                {m.partial && <div className="normal-case font-normal text-[11px]">to date</div>}
              </th>
            ))}
            <th className="px-4 py-2.5 text-right whitespace-nowrap border-l border-outline-variant/50">{totalLabel}</th>
            {showProj && projLabels!.current && <th className={`${projTh} border-l border-dashed border-tertiary/40`}>{projLabels!.current}</th>}
            {showProj && <th className={`${projTh} ${projLabels!.current ? "" : "border-l border-dashed border-tertiary/40"}`}>{projLabels!.next}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            if (r.section) section = r.section;
            const sectionOpen = !section || !closedSections.has(section);
            const hidden = (!sectionOpen && !r.section) || (r.group !== undefined && !openGroups.has(r.group));
            const groupOpen = r.groupHead !== undefined && openGroups.has(r.groupHead);
            return (
              <Fragment key={ri}>
                {r.section && (
                  <tr
                    className="bg-surface-container-low cursor-pointer select-none"
                    onClick={() => toggle(closedSections, r.section!, setClosedSections)}
                  >
                    {/* Spans the whole row so a long heading never widens the name column. */}
                    <td colSpan={months.length + 2 + projCols} className="p-0">
                      <div className="sticky left-0 inline-block px-3 sm:px-4 py-1.5 text-label-caps uppercase text-on-surface-variant whitespace-nowrap">
                        <Chevron open={!closedSections.has(r.section)} /> {r.section}
                      </div>
                    </td>
                  </tr>
                )}
                {!(hidden || (!sectionOpen && r.section)) && (
                  <tr
                    className={`border-b border-outline-variant/30 ${r.strong ? "font-semibold" : ""} ${r.groupHead ? "cursor-pointer select-none hover:bg-surface-container-low/60" : ""}`}
                    onClick={r.groupHead ? () => toggle(openGroups, r.groupHead!, setOpenGroups) : undefined}
                  >
                    <td className={`${labelCls} ${r.indent ? "pl-6 sm:pl-8 text-on-surface-variant" : ""}`}>
                      {r.groupHead && <Chevron open={groupOpen} />} {r.label}
                    </td>
                    {r.values.map((v, i) => {
                      const prev = i > 0 ? r.values[i - 1] : null;
                      const days = months[i].days, prevDays = i > 0 ? months[i - 1].days : undefined;
                      const perDay = !!r.perDay && !!days && !!prevDays;
                      const tone: Tone =
                        r.threshold !== undefined && v !== null && v !== 0
                          ? (v >= r.threshold) === (r.good !== false) ? "good" : "bad"
                          : r.neutral || v === null || prev === null || (months[i].partial && !perDay)
                            ? "none"
                            : perDay
                            ? deltaPerDay(v, prev, days!, prevDays!, r.good !== false).tone
                            : delta(v, prev, r.good !== false).tone;
                      return (
                        <td key={months[i].ym} className="px-1 py-2 text-right whitespace-nowrap">
                          {v === null || v === 0 ? (
                            <span className="text-on-surface-variant px-1.5">—</span>
                          ) : (
                            <Num
                              v={v}
                              unit={r.unit}
                              tone={tone}
                              compact
                              title={
                                prev === null
                                  ? fmtVal(v, r.unit)
                                  : perDay
                                  ? `${fmtVal(v, r.unit)} over ${days} days = ${fmtVal(v / days!, r.unit)}/day — month before ${fmtVal(prev / prevDays!, r.unit)}/day`
                                  : `${fmtVal(v, r.unit)} — month before: ${fmtVal(prev, r.unit)}`
                              }
                            />
                          )}
                          {v ? <Share v={v} base={r.pctBase?.[i]} /> : null}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right tabular whitespace-nowrap border-l border-outline-variant/50 font-semibold">
                      {r.totalValue !== undefined ? (
                        r.totalValue === null ? "" : (
                          <Num
                            v={r.totalValue}
                            unit={r.unit}
                            tone={r.threshold !== undefined ? ((r.totalValue >= r.threshold) === (r.good !== false) ? "good" : "bad") : "none"}
                          />
                        )
                      ) : r.noTotal ? "" : (
                        <>
                          {fmtCompact(r.values.reduce<number>((a, b) => a + (b ?? 0), 0), r.unit)}
                          {r.pctBase && (
                            <Share
                              v={r.values.reduce<number>((a, b) => a + (b ?? 0), 0)}
                              base={r.pctBase.reduce<number>((a, b) => a + (b ?? 0), 0)}
                            />
                          )}
                        </>
                      )}
                    </td>
                    {showProj && projLabels!.current && (
                      <td className={`${projTd} border-l border-dashed border-tertiary/40`}>{r.proj?.current != null ? fmtCompact(r.proj.current, r.unit) : ""}</td>
                    )}
                    {showProj && (
                      <td className={`${projTd} ${projLabels!.current ? "" : "border-l border-dashed border-tertiary/40"}`}>
                        {r.proj?.next != null ? fmtCompact(r.proj.next, r.unit) : ""}
                      </td>
                    )}
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
