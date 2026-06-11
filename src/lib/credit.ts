/**
 * Employee manual credit/tender entry — EBT, other credit-card sales, cash
 * payouts (by category), and house-account charges. House accounts and payout
 * categories are maintained lists. Stored as per-day scalars (Setting table).
 */
import "server-only";
import { prisma } from "./db";
import { getSetting, setSetting } from "./settings";
import { money } from "./calc";

export interface HouseCharge {
  account: string;
  amount: number;
}
export interface CreditManual {
  ebt: number;
  otherCredit: number;
  payouts: HouseCharge[];
  house: HouseCharge[];
}

const DEFAULT_HOUSE = ["Texas Bank", "First Baptist Church"];
const DEFAULT_PAYOUT = ["Employee Pay", "Product Buying"];

async function getList(key: string, fallback: string[]): Promise<string[]> {
  const raw = await getSetting(key);
  if (!raw) return fallback;
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) && a.length ? a.map(String) : fallback;
  } catch {
    return fallback;
  }
}
async function addToList(key: string, fallback: string[], name: string): Promise<void> {
  const n = name.trim();
  if (!n) return;
  const list = await getList(key, fallback);
  if (list.some((x) => x.toLowerCase() === n.toLowerCase())) return;
  await setSetting(key, JSON.stringify([...list, n]));
}

/** Maintained list of house-account names for the dropdown. */
export const getHouseAccounts = () => getList("houseaccounts", DEFAULT_HOUSE);
export const addHouseAccount = (name: string) => addToList("houseaccounts", DEFAULT_HOUSE, name);

/** Maintained list of cash-payout categories for the dropdown. */
export const getPayoutCategories = () => getList("payoutcategories", DEFAULT_PAYOUT);
export const addPayoutCategory = (name: string) => addToList("payoutcategories", DEFAULT_PAYOUT, name);

/** Sum the amounts of a set of line items. */
export function sumLines(items: HouseCharge[]): number {
  return money(items.reduce((s, h) => s + h.amount, 0));
}

function key(locationId: string, dateISO: string): string {
  return `creditmanual:${locationId}:${dateISO}`;
}

function parseLines(raw: unknown): HouseCharge[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h) => {
      const hh = h as { account?: unknown; amount?: unknown };
      return { account: String(hh.account ?? "").trim(), amount: money(Number(hh.amount) || 0) };
    })
    .filter((h) => h.account && h.amount > 0);
}

/** Back-compat: older entries stored payoutCash as a single number. */
function parsePayouts(o: Record<string, unknown>): HouseCharge[] {
  if (Array.isArray(o.payouts)) return parseLines(o.payouts);
  const legacy = money(Number(o.payoutCash) || 0);
  return legacy > 0 ? [{ account: "Payout", amount: legacy }] : [];
}

/** Read the employee's manual credit entry for a day, or null. */
export async function getCreditManual(locationId: string, dateISO: string): Promise<CreditManual | null> {
  const raw = await getSetting(key(locationId, dateISO));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      ebt: money(Number(o.ebt) || 0),
      otherCredit: money(Number(o.otherCredit) || 0),
      payouts: parsePayouts(o),
      house: parseLines(o.house),
    };
  } catch {
    return null;
  }
}

/** Save (upsert) the employee's manual credit entry for a day. */
export async function setCreditManual(locationId: string, dateISO: string, data: CreditManual): Promise<void> {
  await setSetting(key(locationId, dateISO), JSON.stringify({
    ebt: money(data.ebt),
    otherCredit: money(data.otherCredit),
    payouts: data.payouts.map((h) => ({ account: h.account, amount: money(h.amount) })),
    house: data.house.map((h) => ({ account: h.account, amount: money(h.amount) })),
  }));
}

/** Sum manual credit entries across a [start, end) range, or null if none. */
export async function getCreditManualRange(locationId: string, start: Date, end: Date): Promise<CreditManual | null> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: `creditmanual:${locationId}:` } } });
  let ebt = 0, otherCredit = 0, seen = false;
  const houseMap = new Map<string, number>();
  const payoutMap = new Map<string, number>();
  for (const r of rows) {
    const dateISO = r.key.split(":").pop()!;
    const d = new Date(dateISO + "T00:00:00");
    if (d < start || d >= end) continue;
    try {
      const o = JSON.parse(r.value) as Record<string, unknown>;
      ebt += Number(o.ebt) || 0;
      otherCredit += Number(o.otherCredit) || 0;
      for (const h of parseLines(o.house)) houseMap.set(h.account, (houseMap.get(h.account) || 0) + h.amount);
      for (const p of parsePayouts(o)) payoutMap.set(p.account, (payoutMap.get(p.account) || 0) + p.amount);
      seen = true;
    } catch {
      // skip malformed
    }
  }
  if (!seen) return null;
  const toLines = (m: Map<string, number>) =>
    [...m.entries()].map(([account, amount]) => ({ account, amount: money(amount) })).sort((a, b) => b.amount - a.amount);
  return { ebt: money(ebt), otherCredit: money(otherCredit), payouts: toLines(payoutMap), house: toLines(houseMap) };
}
