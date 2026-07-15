/**
 * Date-range helpers for the daily / weekly / monthly / yearly rollups that the
 * dashboard and reports depend on (FR-1, FR-12). Weeks start on Monday.
 */

export type PeriodKey =
  | "today" | "yest" | "wtd" | "mtd" | "lastmonth" | "qtd" | "lastquarter" | "ytd" | "custom"
  | "q1" | "q2" | "q3" | "q4";

export interface Range {
  start: Date;
  end: Date; // exclusive upper bound
  label: string;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(x, -day);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1);
}

export function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

/** Build a named range relative to `now`. End is exclusive (start of next day). */
export function rangeFor(key: PeriodKey, now = new Date()): Range {
  const todayStart = startOfDay(now);
  const tomorrow = addDays(todayStart, 1);
  switch (key) {
    case "today":
      return { start: todayStart, end: tomorrow, label: "Today" };
    case "yest":
      return { start: addDays(todayStart, -1), end: todayStart, label: "Yesterday" };
    case "wtd":
      return { start: startOfWeek(now), end: tomorrow, label: "Week to date" };
    case "mtd":
      return { start: startOfMonth(now), end: tomorrow, label: "This month" };
    case "lastmonth": {
      const thisMonth = startOfMonth(now);
      const lastMonth = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1);
      return { start: lastMonth, end: thisMonth, label: lastMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
    }
    case "qtd":
      return { start: startOfQuarter(now), end: tomorrow, label: "Quarter to date" };
    case "lastquarter": {
      const thisQ = startOfQuarter(now);
      const start = new Date(thisQ.getFullYear(), thisQ.getMonth() - 3, 1);
      return { start, end: thisQ, label: `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}` };
    }
    case "ytd":
      return { start: startOfYear(now), end: tomorrow, label: "Year to date" };
    case "q1":
    case "q2":
    case "q3":
    case "q4": {
      // Calendar quarters of the current year.
      const q = Number(key[1]); // 1..4
      const y = now.getFullYear();
      const start = new Date(y, (q - 1) * 3, 1);
      const end = new Date(y, q * 3, 1);
      return { start, end, label: `Q${q} ${y}` };
    }
    default:
      return { start: startOfMonth(now), end: tomorrow, label: "Month to date" };
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
  const start = startOfDay(new Date(startISO));
  const end = addDays(startOfDay(new Date(endISO)), 1);
  return { start, end, label: `${startISO} → ${endISO}` };
}

/** A list of day-buckets across a range, for trend charts (FR-7). */
export function dayBuckets(r: Range): Date[] {
  const out: Date[] = [];
  let cur = startOfDay(r.start);
  const last = startOfDay(addDays(r.end, -1));
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
