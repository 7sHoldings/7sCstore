import "server-only";
import { prisma } from "../db";
import { todayISO } from "../day";
import { syncRange } from "./sync";

/**
 * Nightly self-healing backfill (runs inside the 12:30 AM cron).
 *
 *  1. Re-pulls the last `recentDays` complete days, so corrections made in
 *     Modisoft after the day closed (voids, edits, late batches) land here.
 *  2. Finds days this year with no POS sales at all and fills them, oldest
 *     first, in ≤10-day chunks, until the time budget runs out. Whatever is
 *     left is picked up the next night.
 *
 * Safe to repeat: syncRange replaces each day's POS rows instead of adding.
 */
const CHUNK_DAYS = 10;
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const at = (s: string) => new Date(`${s}T00:00:00`);

export interface AutoBackfillResult {
  ranges: { from: string; to: string; imported: number; kind: "recent" | "gap" }[];
  imported: number;
  gapsLeft: number; // missing days not reached this run
  stoppedForTime: boolean;
}

export async function autoBackfill(
  locationId: string,
  { recentDays = 7, deadline }: { recentDays?: number; deadline: number }
): Promise<AutoBackfillResult> {
  const today = todayISO();
  const yesterday = iso(new Date(at(today).getTime() - DAY));
  const recentFrom = iso(new Date(at(yesterday).getTime() - (recentDays - 1) * DAY));
  const out: AutoBackfillResult = { ranges: [], imported: 0, gapsLeft: 0, stoppedForTime: false };

  // 1. Recent days — always.
  const n = await syncRange(locationId, at(recentFrom), at(yesterday));
  out.ranges.push({ from: recentFrom, to: yesterday, imported: n, kind: "recent" });
  out.imported += n;

  // 2. Missing days from Jan 1 up to just before the recent window.
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const gapEnd = at(recentFrom); // exclusive
  if (at(yearStart) < gapEnd) {
    const have = await prisma.sale.groupBy({
      by: ["date"],
      where: { locationId, source: "POS_MODI", date: { gte: at(yearStart), lt: gapEnd } },
    });
    const haveDays = new Set(have.map((h) => iso(h.date)));
    const missing: string[] = [];
    for (let t = at(yearStart).getTime(); t < gapEnd.getTime(); t += DAY) {
      const d = iso(new Date(t));
      if (!haveDays.has(d)) missing.push(d);
    }
    // Group consecutive missing days into chunks of at most CHUNK_DAYS.
    const chunks: [string, string][] = [];
    for (const d of missing) {
      const last = chunks[chunks.length - 1];
      const nextOfLast = last ? iso(new Date(at(last[1]).getTime() + DAY)) : "";
      const len = last ? Math.round((at(last[1]).getTime() - at(last[0]).getTime()) / DAY) + 1 : 0;
      if (last && nextOfLast === d && len < CHUNK_DAYS) last[1] = d;
      else chunks.push([d, d]);
    }
    for (let i = 0; i < chunks.length; i++) {
      if (Date.now() > deadline) {
        out.stoppedForTime = true;
        out.gapsLeft = chunks.slice(i).reduce((s, [a, b]) => s + Math.round((at(b).getTime() - at(a).getTime()) / DAY) + 1, 0);
        break;
      }
      const [from, to] = chunks[i];
      const imported = await syncRange(locationId, at(from), at(to));
      out.ranges.push({ from, to, imported, kind: "gap" });
      out.imported += imported;
    }
  }

  const gaps = out.ranges.filter((r) => r.kind === "gap");
  await prisma.syncLog.create({
    data: {
      source: "POS_MODI",
      status: "SUCCESS",
      locationId,
      finishedAt: new Date(),
      recordsImported: out.imported,
      message:
        `Auto backfill: re-pulled ${recentFrom} → ${yesterday}` +
        (gaps.length ? `; filled ${gaps.length} missing range(s) (${gaps.map((g) => (g.from === g.to ? g.from : `${g.from}→${g.to}`)).join(", ")})` : "") +
        (out.stoppedForTime ? `; ${out.gapsLeft} missing day(s) left for tomorrow night` : "") +
        ".",
    },
  });
  return out;
}
