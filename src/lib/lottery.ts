/**
 * Manual lottery entry — employees key in the day's lottery sales and lotto
 * payout from the machine/register. Stored as a per-day scalar so we can compare
 * it against the POS (system) numbers and surface a short/over for the shift.
 */
import "server-only";
import { prisma } from "./db";
import { getSetting, setSetting } from "./settings";
import { money } from "./calc";

export interface LottoManual {
  sales: number;
  payout: number;
  credit: number; // free tickets / credit from the lottery company — adds to net
}

function key(locationId: string, dateISO: string): string {
  return `lottomanual:${locationId}:${dateISO}`;
}

/** Read the employee's manual lottery entry for a day, or null if none. */
export async function getLotteryManual(locationId: string, dateISO: string): Promise<LottoManual | null> {
  const raw = await getSetting(key(locationId, dateISO));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return { sales: money(Number(o.sales) || 0), payout: money(Number(o.payout) || 0), credit: money(Number(o.credit) || 0) };
  } catch {
    return null;
  }
}

/** Save (upsert) the employee's manual lottery entry for a day. */
export async function setLotteryManual(
  locationId: string, dateISO: string, sales: number, payout: number, credit: number = 0
): Promise<void> {
  await setSetting(key(locationId, dateISO), JSON.stringify({ sales: money(sales), payout: money(payout), credit: money(credit) }));
}

/** Sum manual lottery entries across a [start, end) range, or null if none. */
export async function getLotteryManualRange(
  locationId: string, start: Date, end: Date
): Promise<LottoManual | null> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: `lottomanual:${locationId}:` } } });
  let sales = 0, payout = 0, credit = 0, seen = false;
  for (const r of rows) {
    const dateISO = r.key.split(":").pop()!;
    const d = new Date(dateISO + "T00:00:00");
    if (d < start || d >= end) continue;
    try {
      const o = JSON.parse(r.value);
      sales += Number(o.sales) || 0;
      payout += Number(o.payout) || 0;
      credit += Number(o.credit) || 0;
      seen = true;
    } catch {
      // skip malformed
    }
  }
  return seen ? { sales: money(sales), payout: money(payout), credit: money(credit) } : null;
}
