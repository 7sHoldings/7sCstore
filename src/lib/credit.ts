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

/**
 * Two-level cash-payout categories: parent → sub-categories. e.g.
 * { "Product Buying": ["Rave","Frontline"], "Store Expenses": ["Employee Pay", ...] }.
 * Stored as a JSON object under "payouttree". A payout is saved with
 * account = "Parent · Sub" so all existing totals/breakdowns keep working.
 */
export type PayoutTree = Record<string, string[]>;
const DEFAULT_PAYOUT_TREE: PayoutTree = {
  "Product Buying": ["Rave", "Frontline"],
  "Store Expenses": ["Employee Pay", "Pest Control", "Lawn", "Laundry"],
};

export async function getPayoutTree(): Promise<PayoutTree> {
  const raw = await getSetting("payouttree");
  if (!raw) return DEFAULT_PAYOUT_TREE;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const out: PayoutTree = {};
      for (const [k, v] of Object.entries(o)) out[String(k)] = Array.isArray(v) ? v.map(String) : [];
      return Object.keys(out).length ? out : DEFAULT_PAYOUT_TREE;
    }
  } catch { /* fall through */ }
  return DEFAULT_PAYOUT_TREE;
}

/** Add a top-level payout category (parent). Returns the updated tree. */
export async function addPayoutParent(name: string): Promise<PayoutTree> {
  const n = name.trim();
  const tree = await getPayoutTree();
  if (n && !Object.keys(tree).some((k) => k.toLowerCase() === n.toLowerCase())) tree[n] = [];
  await setSetting("payouttree", JSON.stringify(tree));
  return tree;
}

/** Add a sub-category under a parent. Returns the updated tree. */
export async function addPayoutSub(parent: string, name: string): Promise<PayoutTree> {
  const p = parent.trim(), n = name.trim();
  const tree = await getPayoutTree();
  const pk = Object.keys(tree).find((k) => k.toLowerCase() === p.toLowerCase()) ?? p;
  if (!tree[pk]) tree[pk] = [];
  if (n && !tree[pk].some((x) => x.toLowerCase() === n.toLowerCase())) tree[pk].push(n);
  await setSetting("payouttree", JSON.stringify(tree));
  return tree;
}

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

/** Total charges per house account across ALL dates (for running balances). */
export async function getHouseChargeTotals(locationId: string): Promise<Map<string, number>> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: `creditmanual:${locationId}:` } } });
  const m = new Map<string, number>();
  for (const r of rows) {
    try {
      const o = JSON.parse(r.value) as Record<string, unknown>;
      for (const h of parseLines(o.house)) m.set(h.account, (m.get(h.account) || 0) + h.amount);
    } catch { /* skip */ }
  }
  return m;
}

/** Per-date house charges across all accounts, optionally windowed. */
export async function getHouseChargeEntries(
  locationId: string, start?: Date, end?: Date
): Promise<{ date: string; account: string; amount: number }[]> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: `creditmanual:${locationId}:` } } });
  const out: { date: string; account: string; amount: number }[] = [];
  for (const r of rows) {
    const date = r.key.split(":").pop()!;
    const d = new Date(date + "T00:00:00");
    if (start && d < start) continue;
    if (end && d >= end) continue;
    try {
      for (const h of parseLines((JSON.parse(r.value) as Record<string, unknown>).house)) {
        out.push({ date, account: h.account, amount: h.amount });
      }
    } catch { /* skip */ }
  }
  return out;
}

/** Dated payout entries (each day's payout line items), newest first, optionally windowed. */
export async function getDatedPayouts(
  locationId: string, start?: Date, end?: Date
): Promise<{ date: string; items: HouseCharge[]; total: number }[]> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: `creditmanual:${locationId}:` } } });
  const out: { date: string; items: HouseCharge[]; total: number }[] = [];
  for (const r of rows) {
    const date = r.key.split(":").pop()!;
    const d = new Date(date + "T00:00:00");
    if (start && d < start) continue;
    if (end && d >= end) continue;
    try {
      const items = parsePayouts(JSON.parse(r.value) as Record<string, unknown>);
      if (items.length) out.push({ date, items, total: sumLines(items) });
    } catch { /* skip */ }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Total payouts per category across ALL dates. */
export async function getPayoutTotals(locationId: string): Promise<Map<string, number>> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: `creditmanual:${locationId}:` } } });
  const m = new Map<string, number>();
  for (const r of rows) {
    try {
      const o = JSON.parse(r.value) as Record<string, unknown>;
      for (const p of parsePayouts(o)) m.set(p.account, (m.get(p.account) || 0) + p.amount);
    } catch { /* skip */ }
  }
  return m;
}

// ---- House-account payments (reduce the running balance when a customer pays) ----

export interface HousePayment {
  id: string;
  account: string;
  amount: number;
  date: string;
  note?: string;
  photo?: string;
}

export async function getHousePayments(locationId: string): Promise<HousePayment[]> {
  const raw = await getSetting(`housepayments:${locationId}`);
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a)
      ? a.map((p) => ({ id: String(p.id), account: String(p.account), amount: money(Number(p.amount) || 0), date: String(p.date), note: p.note ? String(p.note) : undefined, photo: p.photo ? String(p.photo) : undefined }))
      : [];
  } catch {
    return [];
  }
}

export async function addHousePayment(locationId: string, account: string, amount: number, date: string, note?: string, photo?: string): Promise<void> {
  const list = await getHousePayments(locationId);
  list.push({ id: crypto.randomUUID(), account: account.trim(), amount: money(amount), date, note: note?.trim() || undefined, photo: photo || undefined });
  await setSetting(`housepayments:${locationId}`, JSON.stringify(list));
}

export async function deleteHousePayment(locationId: string, id: string): Promise<void> {
  const list = await getHousePayments(locationId);
  await setSetting(`housepayments:${locationId}`, JSON.stringify(list.filter((p) => p.id !== id)));
}

export async function getHousePaymentTotals(locationId: string): Promise<Map<string, number>> {
  const list = await getHousePayments(locationId);
  const m = new Map<string, number>();
  for (const p of list) m.set(p.account, (m.get(p.account) || 0) + p.amount);
  return m;
}

export interface LedgerEntry {
  date: string;
  kind: "charge" | "payment";
  amount: number;
  note?: string;
  photo?: string;
}

/** Full dated history (charges + payments) for one house account, oldest first. */
export async function getAccountLedger(locationId: string, account: string): Promise<LedgerEntry[]> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: `creditmanual:${locationId}:` } } });
  const out: LedgerEntry[] = [];
  for (const r of rows) {
    const date = r.key.split(":").pop()!;
    try {
      const o = JSON.parse(r.value) as Record<string, unknown>;
      for (const h of parseLines(o.house)) if (h.account === account) out.push({ date, kind: "charge", amount: h.amount });
    } catch { /* skip */ }
  }
  for (const p of await getHousePayments(locationId)) {
    if (p.account === account) out.push({ date: p.date, kind: "payment", amount: p.amount, note: p.note, photo: p.photo });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === "charge" ? -1 : 1));
  return out;
}

/** Per-account running balance = total charged − total paid (incl. accounts with no charges yet). */
export async function getHouseBalances(locationId: string): Promise<{ account: string; charged: number; paid: number; balance: number }[]> {
  const [charges, payments, names] = await Promise.all([
    getHouseChargeTotals(locationId),
    getHousePaymentTotals(locationId),
    getHouseAccounts(),
  ]);
  const accounts = new Set<string>([...names, ...charges.keys(), ...payments.keys()]);
  return [...accounts]
    .map((account) => {
      const charged = money(charges.get(account) || 0);
      const paid = money(payments.get(account) || 0);
      return { account, charged, paid, balance: money(charged - paid) };
    })
    .sort((a, b) => b.balance - a.balance);
}
