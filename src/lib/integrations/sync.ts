import "server-only";
import { prisma } from "../db";
import { dispatchAlert } from "../notify";
import { money, perGallon } from "../calc";
import { modiAdapter } from "./modi";
import { mockModiAdapter } from "./mockModi";
import type { PosAdapter } from "./types";

/** Use the real Modi adapter when configured, otherwise the sandbox. */
export function activeAdapter(): { adapter: PosAdapter; live: boolean } {
  if (modiAdapter.isConfigured()) return { adapter: modiAdapter, live: true };
  return { adapter: mockModiAdapter, live: false };
}

/**
 * Run a POS sync for a location: pull sales since the last successful sync,
 * persist them with source = POS_MODI, and record a SyncLog row. On failure the
 * log is marked FAILED and an alert is raised (FR-43).
 */
export async function runSync(locationId: string): Promise<{ imported: number; live: boolean }> {
  const { adapter, live } = activeAdapter();

  const lastSuccess = await prisma.syncLog.findFirst({
    where: { status: "SUCCESS", locationId },
    orderBy: { startedAt: "desc" },
  });
  const since = lastSuccess?.finishedAt ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7); // first run: last 7 days
    return d;
  })();

  const log = await prisma.syncLog.create({
    data: { source: "POS_MODI", status: "RUNNING", locationId },
  });

  try {
    const rows = await adapter.fetchSince(since);
    let imported = 0;

    for (const s of rows) {
      if (s.category === "FUEL" && s.fuel) {
        await prisma.sale.create({
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
        await prisma.sale.create({
          data: {
            date: s.date,
            locationId,
            category: s.category,
            paymentType: s.paymentType,
            amount: money(s.amount),
            taxCollected: money(s.taxCollected ?? 0),
            note: s.note,
            source: "POS_MODI",
          },
        });
      }
      imported++;
    }

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
