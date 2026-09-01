/**
 * Date-range helpers for the daily / weekly / monthly / yearly rollups that the
 * dashboard and reports depend on (FR-1, FR-12). Weeks start on Monday.
 *
 * Every boundary here is UTC midnight of a STORE calendar date, for two
 * reasons that have to agree:
 *
 *  - Sales are stored that way. The POS reports one row per trading day, and
 *    the sync writes it at midnight, so a day of trading on Aug 26 is the
 *    instant 2026-08-26T00:00:00Z regardless of where the server runs.
 *  - The store's day is not the server's day. Vercel runs in UTC, which turns
 *    over at 5pm Pacific / 7pm Central. Anchoring on the server clock meant
 *    that from late afternoon onwards "Today" silently became tomorrow — and
 *    on the last evening of a month, "This Month" became an empty next month.
 *
 * So the calendar date comes from the store's timezone (STORE_TIMEZONE, the
 * same setting Daily Sales already uses) and the arithmetic is done in UTC.
 */

import { storeTimezone } from "./day";

export type PeriodKey =
  | "today" | "yest" | "wtd" | "mtd" | "lastmonth" | "qtd" | "lastquarter" | "ytd" | "custom"
  | "q1" | "q2" | "q3" | "q4";

export interface Range {
  start: Date;
  end: Date; // exclusive upper bound
  label: string;
}

/** The store's calendar date at this instant, as plain numbers. */
function storeParts(instant: Date): { y: number; m: number; d: number } {
  // en-CA formats as YYYY-MM-DD.
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: storeTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(instant)
    .split("-")
    .map(Number);
  return { y, m, d };
}

/** UTC midnight of the store's calendar date at this instant. */
function storeDayStart(instant: Date): Date {
  const { y, m, d } = storeParts(instant);
  return new Date(Date.UTC(y, m - 1, d));
}

/** UTC midnight of a yyyy-mm-dd string, with no timezone shift. */
function fromISO(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

/** Drop the time from an instant that is already a UTC-based boundary. */
function utcFloor(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** Month name for a UTC-midnight boundary. Read back in UTC, or it slips a day. */
function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function startOfWeek(instant: Date): Date {
  const x = storeDayStart(instant);
  const day = (x.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(x, -day);
}

export function startOfMonth(instant: Date): Date {
  const { y, m } = storeParts(instant);
  return new Date(Date.UTC(y, m - 1, 1));
}

export function startOfQuarter(instant: Date): Date {
  const { y, m } = storeParts(instant);
  return new Date(Date.UTC(y, Math.floor((m - 1) / 3) * 3, 1));
}

export function startOfYear(instant: Date): Date {
  const { y } = storeParts(instant);
  return new Date(Date.UTC(y, 0, 1));
}

/** Build a named range relative to `now`. End is exclusive (start of next day). */
export function rangeFor(key: PeriodKey, now = new Date()): Range {
  const { y, m } = storeParts(now);
  const todayStart = storeDayStart(now);
  const tomorrow = addDays(todayStart, 1);

  switch (key) {
    case "today":
      return { start: todayStart, end: tomorrow, label: "Today" };
    case "yest":
      return { start: addDays(todayStart, -1), end: todayStart, label: "Yesterday" };
    case "wtd":
      return { start: startOfWeek(now), end: tomorrow, label: "Week to date" };
    case "mtd":
      return { start: new Date(Date.UTC(y, m - 1, 1)), end: tomorrow, label: "This month" };
    case "lastmonth": {
      const thisMonth = new Date(Date.UTC(y, m - 1, 1));
      const lastMonth = new Date(Date.UTC(y, m - 2, 1)); // month -1 rolls the year
      return { start: lastMonth, end: thisMonth, label: monthLabel(lastMonth) };
    }
    case "qtd":
      return { start: startOfQuarter(now), end: tomorrow, label: "Quarter to date" };
    case "lastquarter": {
      const q0 = Math.floor((m - 1) / 3) * 3;
      const thisQ = new Date(Date.UTC(y, q0, 1));
      const start = new Date(Date.UTC(y, q0 - 3, 1));
      return {
        start,
        end: thisQ,
        label: `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}`,
      };
    }
    case "ytd":
      return { start: new Date(Date.UTC(y, 0, 1)), end: tomorrow, label: "Year to date" };
    case "q1":
    case "q2":
    case "q3":
    case "q4": {
      // Calendar quarters of the store's current year.
      const q = Number(key[1]); // 1..4
      return {
        start: new Date(Date.UTC(y, (q - 1) * 3, 1)),
        end: new Date(Date.UTC(y, q * 3, 1)),
        label: `Q${q} ${y}`,
      };
    }
    default:
      return { start: new Date(Date.UTC(y, m - 1, 1)), end: tomorrow, label: "Month to date" };
  }
}

/** The immediately-preceding comparable range, for ▲▼ comparisons (FR-6). */
export function previousRange(r: Range): Range {
  const span = r.end.getTime() - r.start.getTime();
  return {
    start: new Date(r.start.getTime() - span),
    end: new Date(r.start.getTime()),
    label: "Previous period",
  };
}

/** Parse an explicit ISO date range (yyyy-mm-dd) into an exclusive Range. */
export function customRange(startISO: string, endISO: string): Range {
  return {
    start: fromISO(startISO),
    end: addDays(fromISO(endISO), 1),
    label: `${startISO} → ${endISO}`,
  };
}

/** A list of day-buckets across a range, for trend charts (FR-7). */
export function dayBuckets(r: Range): Date[] {
  const out: Date[] = [];
  let cur = utcFloor(r.start);
  const last = utcFloor(addDays(r.end, -1));
  let guard = 0;
  while (cur <= last && guard < 800) {
    out.push(new Date(cur));
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
