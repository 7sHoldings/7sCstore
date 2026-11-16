import { Fragment, ReactNode } from "react";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { delta, type Delta, type Tone } from "@/lib/compare";
import { Card, Icon } from "@/components/ui";

/** Row / cell background for a change: green when better, red when worse. */
export const toneBg: Record<Tone, string> = {
  good: "bg-secondary/[0.09]",
  bad: "bg-error/[0.08]",
  flat: "",
  none: "",
};
export const toneText: Record<Tone, string> = {
  good: "text-secondary",
  bad: "text-error",
  flat: "text-on-surface-variant",
  none: "text-on-surface-variant",
};

export type { Unit } from "@/lib/compare";
import type { Unit } from "@/lib/compare";

export function fmtVal(v: number, unit: Unit = "money"): string {
  if (unit === "gal") return `${fmtNumber(Math.round(v))} gal`;
  if (unit === "units") return fmtNumber(Math.round(v));
  return fmtMoney(v);
}

function fmtDiff(v: number, unit: Unit): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return sign + fmtVal(Math.abs(v), unit);
}

/** "+$1,234.00 · +8.2%" with an arrow, coloured by tone. */
export function DeltaChip({ d, unit = "money", big = false }: { d: Delta; unit?: Unit; big?: boolean }) {
  if (d.tone === "none") return <span className="text-on-surface-variant text-body-sm">—</span>;
  const icon = d.tone === "flat" ? "trending_flat" : d.diff > 0 ? "arrow_upward" : "arrow_downward";
  const chip =
    d.tone === "good"
      ? "bg-secondary-container/70 text-on-secondary-container"
      : d.tone === "bad"
      ? "bg-error-container text-on-error-container"
      : "bg-surface-container text-on-surface-variant";
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-0.5 rounded-lg font-semibold tabular max-w-full ${chip} ${big ? "px-2.5 py-1 text-body-sm" : "px-2 py-0.5 text-[12px]"}`}>
      <Icon name={icon} className={big ? "text-[16px]" : "text-[14px]"} />
      <span className="whitespace-nowrap">{fmtDiff(d.diff, unit)}</span>
      <span className="opacity-80 ml-0.5 whitespace-nowrap">{d.pct === null ? "· new" : `· ${d.pct > 0 ? "+" : ""}${d.pct.toFixed(1)}%`}</span>
    </span>
  );
}

/** Headline tile: this month big, the other month small, and the change. */
export function CompareKpi({
  label, icon, d, unit = "money", bLabel, sub, href,
}: {
  label: string; icon: string; d: Delta; unit?: Unit; bLabel: string; sub?: ReactNode; href?: string;
}) {
  const bar = d.tone === "good" ? "border-l-secondary" : d.tone === "bad" ? "border-l-error" : "border-l-outline-variant";
  const body = (
    <Card className={`p-3 sm:p-4 h-full border-l-4 ${bar} ${href ? "hover:shadow-floating transition-shadow" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-label-caps uppercase text-on-surface-variant tracking-wider">{label}</span>
        <Icon name={icon} className="text-[20px] text-primary opacity-70 hidden sm:inline" />
      </div>
      <div className="tabular text-lg sm:text-2xl font-bold text-on-surface mt-1.5 break-words">{fmtVal(d.a, unit)}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <DeltaChip d={d} unit={unit} />
      </div>
      <div className="text-body-sm text-on-surface-variant mt-1.5 tabular">
        {bLabel}: <span className="font-medium text-on-surface">{fmtVal(d.b, unit)}</span>
      </div>
      {sub && <div className="text-body-sm text-on-surface-variant mt-0.5">{sub}</div>}
    </Card>
  );
  return href ? <a href={href} className="block">{body}</a> : body;
}

/** Section card with a title, an optional right-hand note, and an anchor. */
export function Section({
  id, title, icon, note, children,
}: {
  id: string; title: string; icon: string; note?: ReactNode; children: ReactNode;
}) {
  return (
    <Card id={id} className="mb-6 scroll-mt-32 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-outline-variant/50">
        <h2 className="flex items-center gap-2 font-semibold text-on-surface text-headline-sm">
          <Icon name={icon} className="text-[20px] text-primary" />
          {title}
        </h2>
        {note && <div className="text-body-sm text-on-surface-variant">{note}</div>}
      </div>
      {children}
    </Card>
  );
}

/**
 * A comparison table: label · this month · other month · change $ · change %.
 * Rows are tinted green or red by their tone.
 */
export interface CompareRow {
  label: ReactNode;
  d: Delta;
  unit?: Unit;
  strong?: boolean;
  neutral?: boolean; // show the change, but don't colour it
  extra?: ReactNode; // optional trailing cell
  indent?: boolean;
}

export function CompareTable({
  rows, aLabel, bLabel, extraHead, firstHead = "",
}: {
  rows: CompareRow[]; aLabel: string; bLabel: string; extraHead?: string; firstHead?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="text-left text-label-caps uppercase text-on-surface-variant border-b border-outline-variant/50">
            <th className="sticky left-0 z-[1] bg-surface-container-lowest px-5 py-2.5 font-semibold">{firstHead}</th>
            <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">{aLabel}</th>
            <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">{bLabel}</th>
            <th className="px-3 py-2.5 font-semibold text-right">Change</th>
            <th className="px-3 py-2.5 font-semibold text-right">%</th>
            {extraHead !== undefined && <th className="px-5 py-2.5 font-semibold text-right">{extraHead}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const tone: Tone = r.neutral ? "flat" : r.d.tone;
            return (
              <tr key={i} className={`border-b border-outline-variant/30 last:border-0 ${r.strong ? "font-semibold" : ""}`}>
                <td className={`sticky left-0 z-[1] bg-surface-container-lowest px-5 py-2.5 text-on-surface ${r.indent ? "pl-9" : ""}`}>{r.label}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap"><Num v={r.d.a} unit={r.unit} tone={tone} /></td>
                <td className="px-3 py-2.5 text-right tabular text-on-surface-variant whitespace-nowrap">{fmtVal(r.d.b, r.unit)}</td>
                <td className={`px-3 py-2.5 text-right tabular font-semibold whitespace-nowrap ${toneText[tone]}`}>
                  {r.d.tone === "none" ? "—" : fmtDiff(r.d.diff, r.unit ?? "money")}
                </td>
                <td className={`px-3 py-2.5 text-right tabular whitespace-nowrap ${toneText[tone]}`}>
                  {r.d.tone === "none" ? "—" : r.d.pct === null ? "new" : `${r.d.pct > 0 ? "+" : ""}${r.d.pct.toFixed(1)}%`}
                </td>
                {extraHead !== undefined && <td className="px-5 py-2.5 text-right tabular text-on-surface-variant">{r.extra}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Pill classes for a single highlighted number. */
export const cellTone: Record<Tone, string> = {
  good: "bg-secondary/15 text-secondary font-semibold",
  bad: "bg-error/[0.12] text-error font-semibold",
  flat: "text-on-surface",
  none: "text-on-surface",
};

/** One number, highlighted on its own (never its whole row). */
export function Num({
  v, unit = "money", tone = "none", compact = false, title,
}: {
  v: number; unit?: Unit; tone?: Tone; compact?: boolean; title?: string;
}) {
  return (
    <span title={title} className={`inline-block tabular rounded-md px-1.5 py-0.5 -my-0.5 whitespace-nowrap ${cellTone[tone]}`}>
      {compact ? fmtCompact(v, unit) : fmtVal(v, unit)}
    </span>
  );
}

/** Full amount in whole dollars (e.g. $203,412) — no "k" / "M" shorthand. */
export function fmtCompact(v: number, unit: Unit = "money"): string {
  if (unit !== "money") return fmtNumber(Math.round(v));
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
}

export interface GridMonth {
  ym: string;
  label: string;
  partial?: boolean; // running month — shown, but not coloured
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
  section?: string; // small header row before this one
  proj?: { current: number | null; next: number | null } | null;
}

/**
 * Month-by-month grid (January → selected month) with a year total and,
 * optionally, projected columns at the end. Each number is coloured on its
 * own against the month before it.
 */
export function MonthGrid({
  months, rows, totalLabel = "Year total", projLabels,
}: {
  months: GridMonth[];
  rows: GridRow[];
  totalLabel?: string;
  projLabels?: { current: string | null; next: string } | null;
}) {
  const showProj = !!projLabels && rows.some((r) => r.proj);
  const projCols = showProj ? (projLabels!.current ? 2 : 1) : 0;
  const projTh = "px-3 py-2.5 text-right whitespace-nowrap bg-tertiary-container/40 text-on-tertiary-container";
  const projTd = "px-3 py-2 text-right tabular whitespace-nowrap bg-tertiary-container/25 italic text-on-surface";
  return (
    <div className="overflow-x-auto">
      {months.length > 3 && (
        <div className="md:hidden px-4 pt-2 text-[11px] text-on-surface-variant flex items-center gap-1" data-noexport>
          <Icon name="swipe" className="text-[14px]" /> Swipe sideways to see every month
        </div>
      )}
      <table className="text-body-sm min-w-full">
        <thead>
          <tr className="text-label-caps uppercase text-on-surface-variant border-b border-outline-variant/50">
            <th className="sticky left-0 z-[1] bg-surface-container-lowest px-4 py-2.5 text-left min-w-[120px]" />
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
          {rows.map((r, ri) => (
            <Fragment key={ri}>
              {r.section && (
                <tr className="bg-surface-container-low">
                  <td className="sticky left-0 z-[1] bg-surface-container-low px-4 py-1.5 text-label-caps uppercase text-on-surface-variant whitespace-nowrap">{r.section}</td>
                  <td colSpan={months.length + 1 + projCols} />
                </tr>
              )}
              <tr className={`border-b border-outline-variant/30 ${r.strong ? "font-semibold" : ""}`}>
                <td className={`sticky left-0 z-[1] bg-surface-container-lowest px-4 py-2 whitespace-nowrap ${r.indent ? "pl-7" : ""}`}>{r.label}</td>
                {r.values.map((v, i) => {
                  const prev = i > 0 ? r.values[i - 1] : null;
                  const tone: Tone =
                    r.neutral || v === null || prev === null || months[i].partial ? "none" : delta(v, prev, r.good !== false).tone;
                  return (
                    <td key={months[i].ym} className="px-1 py-2 text-right">
                      {v === null || v === 0 ? (
                        <span className="text-on-surface-variant px-1.5">—</span>
                      ) : (
                        <Num
                          v={v}
                          unit={r.unit}
                          tone={tone}
                          compact
                          title={prev !== null ? `${fmtVal(v, r.unit)} — month before: ${fmtVal(prev, r.unit)}` : fmtVal(v, r.unit)}
                        />
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-2 text-right tabular whitespace-nowrap border-l border-outline-variant/50 font-semibold">
                  {r.noTotal ? "" : fmtCompact(r.values.reduce<number>((a, b) => a + (b ?? 0), 0), r.unit)}
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
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A small legend explaining the colours. */
export function ToneLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-body-sm text-on-surface-variant">
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-secondary/30" /> Better than the month before</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-error/30" /> Worse</span>
      <span className="text-[12px]">(for expenses and payouts, spending less is better)</span>
    </div>
  );
}
