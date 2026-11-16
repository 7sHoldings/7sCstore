/**
 * Pure helpers for month-vs-month comparisons on the Monthly Summary.
 * No database access here, so they are easy to reason about and test.
 *
 * Months are "YYYY-MM" strings. Every boundary is UTC midnight of a store
 * calendar date, matching how sales are stored (see lib/period.ts).
 */

export type Tone = "good" | "bad" | "flat" | "none";

export interface Delta {
  a: number; // the selected month
  b: number; // the month it is compared with
  diff: number; // a − b
  pct: number | null; // null = no baseline (b is 0 and a is not)
  tone: Tone;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Compare two values. `higherIsGood` decides the colour: more sales is green,
 * more expenses is red. Changes under half a percent read as flat.
 */
export function delta(a: number, b: number, higherIsGood = true): Delta {
  const diff = round2(a - b);
  const pct = b === 0 ? (a === 0 ? 0 : null) : Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
  let tone: Tone;
  if (a === 0 && b === 0) tone = "none";
  else if (pct !== null && Math.abs(pct) < 0.5) tone = "flat";
  else if (diff === 0) tone = "flat";
  else tone = (diff > 0) === higherIsGood ? "good" : "bad";
  return { a: round2(a), b: round2(b), diff, pct, tone };
}

export interface KeyedDelta extends Delta {
  key: string;
}

/** Line up two keyed lists (e.g. departments) and compare each key. */
export function compareByKey(
  aRows: { key: string; value: number }[],
  bRows: { key: string; value: number }[],
  higherIsGood = true
): KeyedDelta[] {
  const a = new Map<string, number>();
  const b = new Map<string, number>();
  for (const r of aRows) a.set(r.key, (a.get(r.key) ?? 0) + r.value);
  for (const r of bRows) b.set(r.key, (b.get(r.key) ?? 0) + r.value);
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys]
    .map((key) => ({ key, ...delta(a.get(key) ?? 0, b.get(key) ?? 0, higherIsGood) }))
    .filter((r) => r.tone !== "none")
    .sort((x, y) => Math.max(Math.abs(y.a), Math.abs(y.b)) - Math.max(Math.abs(x.a), Math.abs(x.b)));
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

export const isMonth = (s: string | undefined | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function monthStart(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthLabel(ym: string, short = false): string {
  return monthStart(ym).toLocaleDateString("en-US", {
    month: short ? "short" : "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface Window {
  ym: string;
  start: Date;
  end: Date; // exclusive
  days: number; // days covered
  label: string; // "October 2026" or "Oct 1–15, 2026"
}

export type CompareMode = "prev" | "lastyear" | "custom";

export interface CompareWindows {
  a: Window;
  b: Window;
  mode: CompareMode;
  /** True when A is the running month and both sides were cut to the same days. */
  toDate: boolean;
}

function window(ym: string, days: number): Window {
  const start = monthStart(ym);
  const full = daysInMonth(ym);
  const d = Math.max(1, Math.min(days, full));
  const end = new Date(start.getTime() + d * 86400000);
  const short = start.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const label = d >= full ? monthLabel(ym) : `${short} 1–${d}, ${ym.slice(0, 4)}`;
  return { ym, start, end, days: d, label };
}

/**
 * Work out the two windows to compare.
 *
 * `today` is the store's calendar date (YYYY-MM-DD). When the selected month is
 * the running month it only has complete days up to yesterday, so both sides
 * are cut to that many days — Nov 1–15 against Oct 1–15 — otherwise a half
 * month would always look like a collapse. `full` turns that off.
 */
export function compareWindows(
  aYm: string,
  mode: CompareMode,
  customB: string | undefined,
  today: string,
  full = false
): CompareWindows {
  const bYm = mode === "lastyear" ? shiftMonth(aYm, -12) : mode === "custom" && isMonth(customB) ? customB : shiftMonth(aYm, -1);
  const running = today.slice(0, 7) === aYm;
  const completeDays = Math.max(1, Number(today.slice(8, 10)) - 1);
  const toDate = running && !full;
  const aDays = toDate ? completeDays : running ? Number(today.slice(8, 10)) : daysInMonth(aYm);
  const bDays = toDate ? completeDays : daysInMonth(bYm);
  return {
    a: window(aYm, aDays),
    b: window(bYm, bDays),
    mode: mode === "custom" && !isMonth(customB) ? "prev" : mode,
    toDate,
  };
}

/** The default month: the running month, unless today is the 1st (nothing complete yet). */
export function defaultMonth(today: string): string {
  const ym = today.slice(0, 7);
  return Number(today.slice(8, 10)) <= 1 ? shiftMonth(ym, -1) : ym;
}

/** `n` months ending at (and including) `endYm`, oldest first. */
export function monthsEnding(endYm: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftMonth(endYm, i - (n - 1)));
}
