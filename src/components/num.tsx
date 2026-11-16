import { fmtMoney, fmtNumber } from "@/lib/format";
import type { Tone, Unit } from "@/lib/compare";

/** Number formatting + the single highlighted number, shared by every summary table. */
export function fmtVal(v: number, unit: Unit = "money"): string {
  if (unit === "gal") return `${fmtNumber(Math.round(v))} gal`;
  if (unit === "units") return fmtNumber(Math.round(v));
  if (unit === "pct") return `${v.toFixed(1)}%`;
  return fmtMoney(v);
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
  if (unit === "pct") return `${v.toFixed(1)}%`;
  if (unit !== "money") return fmtNumber(Math.round(v));
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
}

