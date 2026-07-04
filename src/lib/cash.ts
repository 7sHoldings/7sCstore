import "server-only";
import { prisma } from "./db";
import { money } from "./calc";

/**
 * Cash (the day's "Safe Drop") lives as a per-day Setting. The POS sync writes
 * `cashdrop:{loc}:{date}`; a manual correction is stored separately as
 * `cashmanual:{loc}:{date}` so it survives the next sync. The effective cash for
 * a day is the manual value when present, else the POS Safe Drop.
 */
export interface CashDay {
  date: string; // yyyy-mm-dd
  pos: number | null; // POS Safe Drop, if synced
  manual: number | null; // manual override, if set
  effective: number; // manual ?? pos ?? 0
}

/** All days with cash activity in [start, end), newest first. */
export async function listCash(loc: string, start: Date, end: Date): Promise<CashDay[]> {
  const rows = await prisma.setting.findMany({
    where: { OR: [{ key: { startsWith: `cashdrop:${loc}:` } }, { key: { startsWith: `cashmanual:${loc}:` } }] },
  });
  const pos = new Map<string, number>();
  const man = new Map<string, number>();
  for (const r of rows) {
    const date = r.key.split(":").pop()!;
    const d = new Date(date + "T00:00:00");
    if (d < start || d >= end) continue;
    const v = Number(r.value) || 0;
    if (r.key.startsWith("cashmanual:")) man.set(date, v);
    else pos.set(date, v);
  }
  const out: CashDay[] = [];
  for (const date of new Set([...pos.keys(), ...man.keys()])) {
    const p = pos.has(date) ? pos.get(date)! : null;
    const m = man.has(date) ? man.get(date)! : null;
    out.push({ date, pos: p, manual: m, effective: m ?? p ?? 0 });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1)); // oldest → newest (1st → month end)
  return out;
}

/** Cash for a single day (POS Safe Drop + manual override, effective value). */
export async function getCashDay(loc: string, dateISO: string): Promise<CashDay> {
  const [posRow, manRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: `cashdrop:${loc}:${dateISO}` } }),
    prisma.setting.findUnique({ where: { key: `cashmanual:${loc}:${dateISO}` } }),
  ]);
  const pos = posRow ? Number(posRow.value) || 0 : null;
  const manual = manRow ? Number(manRow.value) || 0 : null;
  return { date: dateISO, pos, manual, effective: manual ?? pos ?? 0 };
}

/** Effective cash total over [start, end). */
export async function sumCash(loc: string, start: Date, end: Date): Promise<number> {
  const days = await listCash(loc, start, end);
  return days.reduce((s, d) => s + d.effective, 0);
}

/** Set (or clear, when amount is null) the manual cash override for a day. */
export async function setCashManual(loc: string, dateISO: string, amount: number | null): Promise<void> {
  const key = `cashmanual:${loc}:${dateISO}`;
  if (amount == null) {
    await prisma.setting.deleteMany({ where: { key } });
    return;
  }
  const value = String(money(amount));
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/**
 * Card / Credit-Debit for a day. The POS sync writes `ccjobber:{loc}:{date}`
 * (the Credit Card Jobber / Batch total); a manual correction is stored as
 * `cardmanual:{loc}:{date}` and wins over it (survives the next sync).
 */
export async function getCardDay(loc: string, dateISO: string): Promise<CashDay> {
  const [posRow, manRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: `ccjobber:${loc}:${dateISO}` } }),
    prisma.setting.findUnique({ where: { key: `cardmanual:${loc}:${dateISO}` } }),
  ]);
  const pos = posRow ? Number(posRow.value) || 0 : null;
  const manual = manRow ? Number(manRow.value) || 0 : null;
  return { date: dateISO, pos, manual, effective: manual ?? pos ?? 0 };
}

/** Set (or clear, when amount is null) the manual card override for a day. */
export async function setCardManual(loc: string, dateISO: string, amount: number | null): Promise<void> {
  const key = `cardmanual:${loc}:${dateISO}`;
  if (amount == null) {
    await prisma.setting.deleteMany({ where: { key } });
    return;
  }
  const value = String(money(amount));
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
