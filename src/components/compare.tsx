import { Fragment, ReactNode } from "react";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { delta, type Delta, type Tone } from "@/lib/compare";
import { Card, Icon } from "@/components/ui";
import { SectionShot } from "@/components/SummaryExport";

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
import { fmtVal, fmtCompact, cellTone, Num } from "@/components/num";
export { fmtVal, fmtCompact, cellTone, Num };
export { MonthGrid } from "@/components/MonthGrid";
export type { GridMonth, GridRow } from "@/components/MonthGrid";


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
  id, title, icon, note, children, shot, defaultOpen = true,
}: {
  id: string;
  title: string;
  icon: string;
  note?: ReactNode;
  children: ReactNode;
  /** Adds a "Screenshot" button for just this section; caption shows on the picture. */
  shot?: { fileName: string; caption: string };
  /** Sections fold: tap the title to open/close. */
  defaultOpen?: boolean;
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      data-section
      className="group mb-6 scroll-mt-32 overflow-hidden bg-surface-container-lowest border border-outline-variant/60 rounded-lg shadow-card"
    >
      {shot && (
        <div className="hidden [.exporting-section_&]:block px-5 pt-4 text-body-sm text-on-surface-variant whitespace-nowrap">{shot.caption}</div>
      )}
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-4 group-open:border-b border-outline-variant/50 hover:bg-surface-container-low/50">
        <h2 className="flex items-center gap-2 font-semibold text-on-surface text-headline-sm">
          <span aria-hidden className="material-symbols-outlined text-[22px] text-on-surface-variant transition-transform -rotate-90 group-open:rotate-0" data-noexport>
            expand_more
          </span>
          <Icon name={icon} className="text-[20px] text-primary" />
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {note && <div className="text-body-sm text-on-surface-variant">{note}</div>}
          {shot && <SectionShot targetId={id} fileName={shot.fileName} />}
        </div>
      </summary>
      {children}
    </details>
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
  threshold?: number; // colour the number against a fixed target (e.g. 30%)
  lowerIsBetter?: boolean; // with threshold: below the target is good
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
            <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">{bLabel}</th>
            <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">{aLabel}</th>
            <th className="px-3 py-2.5 font-semibold text-right">Change</th>
            <th className="px-3 py-2.5 font-semibold text-right">%</th>
            {extraHead !== undefined && <th className="px-5 py-2.5 font-semibold text-right">{extraHead}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const tone: Tone =
              r.threshold !== undefined
                ? (r.d.a >= r.threshold) !== !!r.lowerIsBetter ? "good" : "bad"
                : r.neutral ? "flat" : r.d.tone;
            return (
              <tr key={i} className={`border-b border-outline-variant/30 last:border-0 ${r.strong ? "font-semibold" : ""}`}>
                <td className={`sticky left-0 z-[1] bg-surface-container-lowest px-5 py-2.5 text-on-surface ${r.indent ? "pl-9" : ""}`}>{r.label}</td>
                <td className="px-3 py-2.5 text-right tabular text-on-surface-variant whitespace-nowrap">{fmtVal(r.d.b, r.unit)}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap"><Num v={r.d.a} unit={r.unit} tone={tone} /></td>
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

/** A small legend explaining the colours. */
export function ToneLegend({ better = "Better than the month before" }: { better?: string } = {}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-body-sm text-on-surface-variant">
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-secondary/30" /> {better}</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-error/30" /> Worse</span>
      <span className="text-[12px]">(sales compare the daily average · for expenses, spending less is better)</span>
    </div>
  );
}
