import "server-only";
import { prisma } from "../db";
import { dispatchAlert } from "../notify";
import { money, perGallon } from "../calc";
import { modiAdapter } from "./modi";
import { modiInsightsAdapter } from "./modiInsights";
import { mockModiAdapter } from "./mockModi";
import type { PosAdapter, NormalizedSale, PricePushResult } from "./types";

/**
 * Pick the active adapter: official API (MODI_API_URL+KEY) → Insights session
 * cookie (MODI_COOKIE) → sandbox. The first two are "live".
 */
export function activeAdapter(): { adapter: PosAdapter; live: boolean } {
  if (modiAdapter.isConfigured()) return { adapter: modiAdapter, live: true };
  if (modiInsightsAdapter.isConfigured()) return { adapter: modiInsightsAdapter, live: true };
  return { adapter: mockModiAdapter, live: false };
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Insert normalized POS rows; fuel rows also create the FuelSale detail. */
async function insertRows(
  tx: Pick<typeof prisma, "sale">,
  locationId: string,
  rows: NormalizedSale[]
): Promise<number> {
  let n = 0;
  for (const s of rows) {
    if (s.category === "FUEL" && s.fuel) {
      await tx.sale.create({
        data: {
          date: s.date,
          locationId,
          category: "FUEL",
          paymentType: s.paymentType,
          amount: money(s.amount),
          taxCollected: 0,
          note: s.note,
          source: "POS_MODI",
          fuelSale: {
            create: {
              date: s.date,
              locationId,
              grade: s.fuel.grade,
              gallons: s.fuel.gallons,
              pricePerGallon: perGallon(s.fuel.pricePerGallon),
              total: money(s.amount),
              taxPerGallon: perGallon(s.fuel.taxPerGallon ?? 0),
              costPerGallon: perGallon(s.fuel.costPerGallon ?? 0),
            },
          },
        },
      });
    } else {
      await tx.sale.create({
        data: {
          date: s.date,
          locationId,
          category: s.category,
          paymentType: s.paymentType,
          amount: money(s.amount),
          taxCollected: money(s.taxCollected ?? 0),
          refund: money(s.refund ?? 0),
          note: s.note,
          source: "POS_MODI",
        },
      });
    }
    n++;
  }
  return n;
}

/**
 * Idempotently sync a [from, to] day range: fetch from the POS, delete existing
 * POS_MODI rows in that window, then insert the fresh data. Safe to re-run for
 * the same dates (no double-counting). Does NOT write a SyncLog — callers decide.
 */
export async function syncRange(locationId: string, from: Date, to: Date): Promise<number> {
  const { adapter } = activeAdapter();
  const rows = adapter.fetchRange
    ? await adapter.fetchRange(from, to)
    : await adapter.fetchSince(from);

  const windowStart = startOfDay(from);
  const windowEnd = startOfDay(to);
  windowEnd.setDate(windowEnd.getDate() + 1); // exclusive upper bound (whole `to` day)

  const imported = await prisma.$transaction(async (tx) => {
    await tx.sale.deleteMany({
      where: { source: "POS_MODI", locationId, date: { gte: windowStart, lt: windowEnd } },
    });
    return insertRows(tx, locationId, rows);
  });

  // Promotions deducted per day, split merch vs fuel (from the same rows we just
  // imported). Stored as per-day scalars to surface on the Daily Sales panels.
  const promoByDay = new Map<string, { merch: number; fuel: number }>();
  for (const s of rows) {
    if (!s.promotion) continue;
    const dISO = startOfDay(s.date).toISOString().slice(0, 10);
    const e = promoByDay.get(dISO) ?? { merch: 0, fuel: 0 };
    if (s.category === "FUEL") e.fuel += s.promotion;
    else if (s.category !== "LOTTERY") e.merch += s.promotion;
    promoByDay.set(dISO, e);
  }
  for (const [dISO, e] of promoByDay) {
    await prisma.setting.upsert({
      where: { key: `promomerch:${locationId}:${dISO}` },
      create: { key: `promomerch:${locationId}:${dISO}`, value: String(money(e.merch)) },
      update: { value: String(money(e.merch)) },
    });
    await prisma.setting.upsert({
      where: { key: `promofuel:${locationId}:${dISO}` },
      create: { key: `promofuel:${locationId}:${dISO}`, value: String(money(e.fuel)) },
      update: { value: String(money(e.fuel)) },
    });
  }

  // Pull the real Sales Tax per day (report 36) and stash it as a per-day scalar.
  if (adapter.fetchTax) {
    try {
      const taxes = await adapter.fetchTax(from, to);
      for (const t of taxes) {
        const key = `tax:${locationId}:${t.date}`;
        await prisma.setting.upsert({
          where: { key },
          create: { key, value: String(t.tax) },
          update: { value: String(t.tax) },
        });
      }
    } catch {
      // Sales tax is best-effort — never fail the whole sync over it.
    }
  }

  // Pull the actual tender per day (Daily Entry): cash = Safe Drop, card = Credit
  // Card Jobber (Batch). Stored as per-day scalars for the Daily Sales view.
  if (adapter.fetchTender) {
    try {
      const tenders = await adapter.fetchTender(from, to);
      for (const t of tenders) {
        await prisma.setting.upsert({
          where: { key: `cashdrop:${locationId}:${t.date}` },
          create: { key: `cashdrop:${locationId}:${t.date}`, value: String(t.cash) },
          update: { value: String(t.cash) },
        });
        await prisma.setting.upsert({
          where: { key: `ccjobber:${locationId}:${t.date}` },
          create: { key: `ccjobber:${locationId}:${t.date}`, value: String(t.card) },
          update: { value: String(t.card) },
        });
      }
    } catch {
      // Tender is best-effort — never fail the whole sync over it.
    }
  }

  return imported;
}

/** Sum the stored promotions deducted (merch + fuel) over a [start, end) range. */
export async function getPromoRange(
  locationId: string, start: Date, end: Date
): Promise<{ merch: number; fuel: number }> {
  const rows = await prisma.setting.findMany({
    where: { OR: [{ key: { startsWith: `promomerch:${locationId}:` } }, { key: { startsWith: `promofuel:${locationId}:` } }] },
  });
  let merch = 0, fuel = 0;
  for (const r of rows) {
    const dateISO = r.key.split(":").pop()!;
    const d = new Date(dateISO + "T00:00:00");
    if (d < start || d >= end) continue;
    if (r.key.startsWith(`promomerch:`)) merch += Number(r.value) || 0;
    else fuel += Number(r.value) || 0;
  }
  return { merch, fuel };
}

/** Sum the stored real tender (Safe Drop cash + Credit Card Jobber) over a range.
 *  A manual cash override (`cashmanual:`) wins over the POS Safe Drop for its day. */
export async function getTenderRange(
  locationId: string, start: Date, end: Date
): Promise<{ cash: number; card: number } | null> {
  const rows = await prisma.setting.findMany({
    where: { OR: [
      { key: { startsWith: `cashdrop:${locationId}:` } },
      { key: { startsWith: `cashmanual:${locationId}:` } },
      { key: { startsWith: `ccjobber:${locationId}:` } },
    ] },
  });
  const posCash = new Map<string, number>();
  const manCash = new Map<string, number>();
  let card = 0, seen = false;
  for (const r of rows) {
    const dateISO = r.key.split(":").pop()!;
    const d = new Date(dateISO + "T00:00:00");
    if (d < start || d >= end) continue;
    seen = true;
    if (r.key.startsWith(`cashmanual:`)) manCash.set(dateISO, Number(r.value) || 0);
    else if (r.key.startsWith(`cashdrop:`)) posCash.set(dateISO, Number(r.value) || 0);
    else card += Number(r.value) || 0;
  }
  let cash = 0;
  for (const dateISO of new Set([...posCash.keys(), ...manCash.keys()])) {
    cash += manCash.has(dateISO) ? manCash.get(dateISO)! : posCash.get(dateISO)!;
  }
  return seen ? { cash, card } : null;
}

/** Read the stored real Sales Tax for a day, or null if not synced. */
export async function getTaxForDay(locationId: string, dateISO: string): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key: `tax:${locationId}:${dateISO}` } });
  if (!row) return null;
  const n = Number(row.value);
  return isFinite(n) ? n : null;
}

/** Sum stored real Sales Tax across a [start, end) date range (0 if none synced). */
export async function getTaxRange(locationId: string, start: Date, end: Date): Promise<number> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: `tax:${locationId}:` } } });
  let total = 0;
  for (const r of rows) {
    const dateISO = r.key.split(":").pop()!;
    const d = new Date(dateISO + "T00:00:00");
    if (d >= start && d < end) total += Number(r.value) || 0;
  }
  return total;
}

/** Read stored per-hour sales for a day (24 values) or null if not synced. */
export async function getHourly(locationId: string, dateISO: string): Promise<number[] | null> {
  const row = await prisma.setting.findUnique({ where: { key: `hourly:${locationId}:${dateISO}` } });
  if (!row) return null;
  try {
    const arr = JSON.parse(row.value);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

/** Read the stored customer/transaction count for a day, or null. */
export async function getCustomers(locationId: string, dateISO: string): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key: `customers:${locationId}:${dateISO}` } });
  if (!row) return null;
  const n = Number(row.value);
  return isFinite(n) && n > 0 ? n : null;
}

/** Sum stored customer counts across a [start, end) date range. */
export async function getCustomersRange(locationId: string, start: Date, end: Date): Promise<number> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: `customers:${locationId}:` } } });
  let total = 0;
  for (const r of rows) {
    const dateISO = r.key.split(":").pop()!;
    const d = new Date(dateISO + "T00:00:00");
    if (d >= start && d < end) total += Number(r.value) || 0;
  }
  return total;
}

/**
 * Incremental sync (the "Sync now" button): pulls from the last successful sync
 * (or the last 7 days on first run) up to now, logs the run, and alerts on
 * failure (FR-43).
 */
export async function runSync(locationId: string): Promise<{ imported: number; live: boolean }> {
  const { live } = activeAdapter();

  const lastSuccess = await prisma.syncLog.findFirst({
    where: { status: "SUCCESS", locationId },
    orderBy: { startedAt: "desc" },
  });
  const since = lastSuccess?.finishedAt ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  })();

  const log = await prisma.syncLog.create({
    data: { source: "POS_MODI", status: "RUNNING", locationId },
  });

  try {
    const imported = await syncRange(locationId, since, new Date());
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        recordsImported: imported,
        message: live ? "Synced from Modi POS." : "Synced from Modi sandbox (no live credentials).",
      },
    });
    return { imported, live };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown sync error";
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: "FAILED", finishedAt: new Date(), message },
    });
    await dispatchAlert({
      locationId,
      type: "POS_SYNC_FAILURE",
      severity: "error",
      message: `POS sync failed: ${message}`,
    });
    throw e;
  }
}

/**
 * Pull the current item-wise inventory from the POS and upsert Products by UPC.
 * POS is the source of truth for name, category, cost, price and on-hand qty;
 * app-managed planning fields (case size, vendor, margin, reorder point, par)
 * are preserved on existing products. Returns counts + the live/source flag.
 */
export async function syncInventory(
  locationId: string
): Promise<{ created: number; updated: number; total: number; mappedDept: number; live: boolean }> {
  const { adapter, live } = activeAdapter();
  if (!adapter.fetchInventory) {
    throw new Error(`The ${adapter.label} connection can't pull inventory yet.`);
  }
  const items = await adapter.fetchInventory();

  // Dedupe by POS ItemKey (the stable match key).
  const byKey = new Map<number, (typeof items)[number]>();
  for (const it of items) if (it.posItemId) byKey.set(it.posItemId, it);
  const mappedDept = [...byKey.values()].filter((it) => it.posDeptId != null).length;

  // Existing POS-linked products for this location.
  const existing = await prisma.product.findMany({
    where: { locationId, posItemId: { not: null } },
    select: { id: true, posItemId: true, name: true, sellingPrice: true, category: true, posDeptId: true, department: true },
  });
  const existingByKey = new Map(existing.map((p) => [p.posItemId!, p]));

  // New items → bulk insert. POS owns name/category/price; cost & qty are left
  // at 0 (POS doesn't track them) for you to set via wholesale + physical count.
  const toCreate = [...byKey.values()].filter((it) => !existingByKey.has(it.posItemId));
  let created = 0;
  for (let i = 0; i < toCreate.length; i += 1000) {
    const chunk = toCreate.slice(i, i + 1000).map((it) => ({
      locationId,
      name: it.name,
      category: it.category as never,
      posItemId: it.posItemId,
      posDeptId: it.posDeptId ?? null,
      department: it.department ?? null,
      upc: it.upc || null,
      unitsPerCase: it.unitsPerCase,
      caseCost: 0,
      currentCost: 0,
      sellingPrice: money(it.retailPrice),
      qtyOnHand: 0,
      source: "POS_MODI" as const,
    }));
    const res = await prisma.product.createMany({ data: chunk, skipDuplicates: true });
    created += res.count;
  }

  // Existing items → refresh only name/category/retail when they changed.
  // Never touch cost, qty, case size, vendor, margin or reorder points.
  let updated = 0;
  const toUpdate = [...byKey.values()].filter((it) => {
    const p = existingByKey.get(it.posItemId);
    return p && (
      money(it.retailPrice) !== p.sellingPrice ||
      (it.name && it.name !== p.name) ||
      it.category !== p.category ||
      (it.posDeptId != null && it.posDeptId !== p.posDeptId) ||
      (it.department != null && it.department !== p.department)
    );
  });
  for (let i = 0; i < toUpdate.length; i += 50) {
    await prisma.$transaction(
      toUpdate.slice(i, i + 50).map((it) =>
        prisma.product.update({
          where: { id: existingByKey.get(it.posItemId)!.id },
          data: {
            name: it.name || undefined,
            category: it.category as never,
            sellingPrice: money(it.retailPrice),
            posDeptId: it.posDeptId ?? undefined,
            department: it.department ?? undefined,
          },
        })
      )
    );
    updated += Math.min(50, toUpdate.length - i);
  }

  await prisma.syncLog.create({
    data: {
      source: "POS_MODI", status: "SUCCESS", locationId, finishedAt: new Date(),
      recordsImported: created + updated, message: `Inventory pull: ${created} new, ${updated} updated.`,
    },
  });
  return { created, updated, total: byKey.size, mappedDept, live };
}

/**
 * Push app retail prices → POS for the given products. Each item must already
 * carry posItemId + posDeptId (set on inventory pull). On a successful push we
 * mirror the new price into the local Product so the app and POS stay in lock-
 * step. Returns the per-product outcome plus the live/source flag.
 */
export async function pushPrices(
  locationId: string,
  items: { productId: string; posItemId: number; posDeptId: number | null; newRetail: number }[]
): Promise<{ live: boolean; results: (PricePushResult & { productId: string })[] }> {
  const { adapter, live } = activeAdapter();
  if (!adapter.pushItemPricesBulk) {
    throw new Error(`The ${adapter.label} connection can't push prices.`);
  }
  if (!live) {
    return {
      live,
      results: items.map((it) => ({ productId: it.productId, posItemId: it.posItemId, ok: false, oldPrice: null, error: "No live Modisoft connection (set MODI_COOKIE)." })),
    };
  }

  const reqs = items
    .filter((it) => it.posItemId && it.posDeptId)
    .map((it) => ({ posItemId: it.posItemId, posDeptId: it.posDeptId!, newRetail: it.newRetail }));
  const pushed = await adapter.pushItemPricesBulk(reqs);
  const byItem = new Map(pushed.map((r) => [r.posItemId, r]));

  const results: (PricePushResult & { productId: string })[] = [];
  const toMirror: { id: string; price: number }[] = [];
  for (const it of items) {
    if (!it.posItemId || !it.posDeptId) {
      results.push({ productId: it.productId, posItemId: it.posItemId, ok: false, oldPrice: null, error: "No POS department mapped — pull inventory again first." });
      continue;
    }
    const r = byItem.get(it.posItemId) ?? { posItemId: it.posItemId, ok: false, oldPrice: null, error: "No response from POS." };
    results.push({ ...r, productId: it.productId });
    if (r.ok && !r.skipped) toMirror.push({ id: it.productId, price: money(it.newRetail) });
  }

  // Mirror successfully-pushed prices into the local catalog.
  for (let i = 0; i < toMirror.length; i += 50) {
    await prisma.$transaction(
      toMirror.slice(i, i + 50).map((m) =>
        prisma.product.update({ where: { id: m.id }, data: { sellingPrice: m.price } })
      )
    );
  }

  const okCount = results.filter((r) => r.ok && !r.skipped).length;
  await prisma.syncLog.create({
    data: {
      source: "POS_MODI", status: "SUCCESS", locationId, finishedAt: new Date(),
      recordsImported: okCount, message: `Price push: ${okCount} updated, ${results.filter((r) => r.skipped).length} unchanged, ${results.filter((r) => !r.ok).length} failed.`,
    },
  });

  return { live, results };
}

/** Write a one-line SyncLog summarizing a completed backfill. */
export async function logBackfill(locationId: string, imported: number, fromISO: string, toISO: string): Promise<void> {
  await prisma.syncLog.create({
    data: {
      source: "POS_MODI",
      status: "SUCCESS",
      locationId,
      finishedAt: new Date(),
      recordsImported: imported,
      message: `Backfill ${fromISO} → ${toISO}.`,
    },
  });
}
