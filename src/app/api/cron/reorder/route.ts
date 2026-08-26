import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateDraftOrder, refreshDraftOrder } from "@/lib/vendors/draftOrder";
import { syncDemand } from "@/lib/integrations/sync";

/**
 * Order builder, triggered daily by Vercel Cron (see vercel.json — 13:00 UTC =
 * 8:00 AM CST).
 *
 * Monday starts the week's order fresh. Every other day the open draft is
 * refreshed in place from that day's sales: forecasts update and newly needed
 * products appear, but a quantity the owner set by hand is never overwritten.
 * That way the order is always current, whichever day it gets placed.
 *
 * Placed orders are never touched.
 *
 * Protected by CRON_SECRET the same way as the nightly sync.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  }

  // Monday rebuilds the week's order; other days keep the open draft current.
  const isMonday = new Date().getUTCDay() === 1;

  const locations = await prisma.location.findMany();
  const results: {
    location: string; mode?: string; lines?: number; totalCost?: number;
    added?: number; removed?: number; keptEdited?: number; error?: string;
  }[] = [];

  for (const loc of locations) {
    try {
      // Today's sales first, so either path forecasts from current numbers.
      try {
        await syncDemand(loc.id);
      } catch (e) {
        console.error("demand pull failed; using the last known window", e);
      }

      if (isMonday) {
        const r = await generateDraftOrder(loc.id, { vendor: "GSC" });
        results.push({ location: loc.name, mode: "rebuilt", lines: r.lines, totalCost: r.totalCost });
      } else {
        const r = await refreshDraftOrder(loc.id, { vendor: "GSC" });
        results.push({
          location: loc.name, mode: "refreshed",
          lines: r.updated + r.added, added: r.added, removed: r.removed, keptEdited: r.kept,
        });
      }
    } catch (e) {
      console.error("reorder failed", e);
      results.push({ location: loc.name, error: e instanceof Error ? e.message : "failed" });
    }
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), monday: isMonday, results });
}
