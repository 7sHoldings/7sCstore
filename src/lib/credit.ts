/**
 * Employee manual credit/tender entry — EBT, other credit-card sales, cash
 * payouts, and house-account charges (with a maintained list of house accounts).
 * Stored as per-day scalars (Setting table) so the owner can review them.
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
  payoutCash: number;
  house: HouseCharge[];
}

const DEFAULT_HOUSE = ["Texas Bank", "First Baptist Church"];

/** The maintained list of house-account names for the dropdown. */
export async function getHouseAccounts(): Promise<string[]> {
  const raw = await getSetting("houseaccounts");
  if (!raw) return DEFAULT_HOUSE;
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) && a.length ? a.map(String) : DEFAULT_HOUSE;
  } catch {
    return DEFAULT_HOUSE;
  }
}

/** Append a new house account (no-op if blank or already present). */
export async function addHouseAccount(name: string): Promise<void> {
  const n = name.trim();
  if (!n) return;
  const list = await getHouseAccounts();
  if (list.some((x) => x.toLowerCase() === n.toLowerCase())) return;
  await setSetting("houseaccounts", JSON.stringify([...list, n]));
}

function key(locationId: string, dateISO: string): string {
  return `creditmanual:${locationId}:${dateISO}`;
}

function parseHouse(raw: unknown): HouseCharge[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h) => {
      const hh = h as { account?: unknown; amount?: unknown };
      return { account: String(hh.account ?? "").trim(), amount: money(Number(hh.amount) || 0) };
    })
    .filter((h) => h.account && h.amount > 0);
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
      payoutCash: money(Number(o.payoutCash) || 0),
      house: parseHouse(o.house),
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
    payoutCash: money(data.payoutCash),
    house: data.house.map((h) => ({ account: h.account, amount: money(h.amount) })),
  }));
}

/** Sum manual credit entries across a [start, end) range, or null if none. */
export async function getCreditManualRange(locationId: string, start: Date, end: Date): Promise<CreditManual | null> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: `creditmanual:${locationId}:` } } });
  let ebt = 0, otherCredit = 0, payoutCash = 0, seen = false;
  const houseMap = new Map<string, number>();
  for (const r of rows) {
    const dateISO = r.key.split(":").pop()!;
    const d = new Date(dateISO + "T00:00:00");
    if (d < start || d >= end) continue;
    try {
      const o = JSON.parse(r.value) as Record<string, unknown>;
      ebt += Number(o.ebt) || 0;
      otherCredit += Number(o.otherCredit) || 0;
      payoutCash += Number(o.payoutCash) || 0;
      for (const h of parseHouse(o.house)) houseMap.set(h.account, (houseMap.get(h.account) || 0) + h.amount);
      seen = true;
    } catch {
      // skip malformed
    }
  }
  if (!seen) return null;
  const house = [...houseMap.entries()]
    .map(([account, amount]) => ({ account, amount: money(amount) }))
    .sort((a, b) => b.amount - a.amount);
  return { ebt: money(ebt), otherCredit: money(otherCredit), payoutCash: money(payoutCash), house };
}
