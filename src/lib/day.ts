/**
 * Date helpers that respect the store's timezone, so "today" doesn't roll over
 * at UTC midnight (which is evening in the US). Configure via STORE_TIMEZONE
 * (IANA name, e.g. "America/Los_Angeles"); defaults to US Pacific.
 */
export function storeTimezone(): string {
  return process.env.STORE_TIMEZONE || "America/Los_Angeles";
}

/** Current date as YYYY-MM-DD in the store's timezone. */
export function todayISO(tz: string = storeTimezone()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Yesterday's date as YYYY-MM-DD in the store's timezone. */
export function yesterdayISO(tz: string = storeTimezone()): string {
  const [y, m, d] = todayISO(tz).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/** A Date (from the DB) rendered as YYYY-MM-DD in the store's timezone. */
export function toISODate(d: Date, tz: string = storeTimezone()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
