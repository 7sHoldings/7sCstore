import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runSync, syncInventory, syncDemand } from "@/lib/integrations/sync";
import { autoBackfill } from "@/lib/integrations/autoBackfill";
import { dispatchAlert } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Room for the nightly backfill below (it stops itself well before this).
export const maxDuration = 300;

/**
 * Nightly POS sync, triggered by Vercel Cron (see vercel.json — 06:30 UTC =
 * 12:30 AM CST). Pulls each location's data since the last successful sync,
 * then runs the automatic backfill (last 7 days + any missing days this year).
 * runSync() logs the run and raises a failure alert (e.g. expired cookie).
 *
 * Protected by CRON_SECRET: Vercel automatically sends it as a Bearer token
 * when the env var is set. If unset, the endpoint runs unauthenticated.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const started = Date.now();
  // The POS connection is one Modisoft store. Only sync locations that have
  // had POS data recently — a placeholder location (e.g. "Coming Soon") must
  // never receive another store's sales.
  const recent = new Date(Date.now() - 60 * 86_400_000);
  const active = await prisma.sale.groupBy({
    by: ["locationId"],
    where: { source: "POS_MODI", date: { gte: recent } },
  });
  const activeIds = new Set(active.map((a) => a.locationId));
  const locations = (await prisma.location.findMany()).filter((l) => activeIds.has(l.id));
  const results: {
    location: string; imported?: number; inventory?: number; demand?: number; backfilled?: number; gapsLeft?: number; error?: string;
  }[] = [];

  for (const loc of locations) {
    try {
      const r = await runSync(loc.id);

      // Self-healing backfill FIRST (it is short): re-pull the last 7 days to
      // catch late corrections in Modisoft, then fill any missing days this
      // year. The slower inventory / demand pulls run after it.
      let backfilled: number | undefined, gapsLeft: number | undefined;
      try {
        const b = await autoBackfill(loc.id, { deadline: started + 120_000 });
        backfilled = b.imported;
        gapsLeft = b.gapsLeft;
      } catch (e) {
        const message = e instanceof Error ? e.message : "failed";
        console.error("nightly backfill failed", e);
        await prisma.syncLog.create({
          data: { source: "POS_MODI", status: "FAILED", locationId: loc.id, finishedAt: new Date(), message: `Auto backfill failed: ${message}` },
        });
        await dispatchAlert({ locationId: loc.id, type: "POS_SYNC_FAILURE", severity: "error", message: `Nightly backfill failed: ${message}` });
      }

      // Today's inventory reading. Two readings apart in time are what make the
      // weekly reorder measurable. A failure here must not mask the sales sync.
      let inventory: number | undefined;
      try {
        const inv = await syncInventory(loc.id);
        inventory = inv.total;
      } catch (e) {
        console.error("nightly inventory pull failed", e);
      }
      // Refresh the rolling sales window that drives the weekly forecast.
      let demand: number | undefined;
      try {
        const d = await syncDemand(loc.id);
        demand = d.measured;
      } catch (e) {
        console.error("nightly demand pull failed", e);
      }
      results.push({ location: loc.name, imported: r.imported, inventory, demand, backfilled, gapsLeft });
    } catch (e) {
      results.push({ location: loc.name, error: e instanceof Error ? e.message : "failed" });
    }
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), results });
}
