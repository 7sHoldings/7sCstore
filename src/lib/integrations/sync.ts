import "server-only";
import { prisma } from "../db";
import { dispatchAlert } from "../notify";
import { money, perGallon } from "../calc";
import { modiAdapter } from "./modi";
import { modiInsightsAdapter } from "./modiInsights";
import { mockModiAdapter } from "./mockModi";
import type { PosAdapter, NormalizedSale } from "./types";

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

  return imported;
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
