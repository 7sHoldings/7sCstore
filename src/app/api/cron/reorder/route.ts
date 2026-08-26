import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateDraftOrder } from "@/lib/vendors/draftOrder";

/**
 * Weekly order builder, triggered by Vercel Cron (see vercel.json — Monday
 * 13:00 UTC = 8:00 AM CST). Builds a DRAFT order per location from measured
 * sales so the owner reviews and adjusts rather than starting from a blank
 * screen. Regenerating replaces the open draft; placed orders are untouched.
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

  const locations = await prisma.location.findMany();
  const results: { location: string; lines?: number; totalCost?: number; error?: string }[] = [];

  for (const loc of locations) {
    try {
      const r = await generateDraftOrder(loc.id, { vendor: "GSC" });
      results.push({ location: loc.name, lines: r.lines, totalCost: r.totalCost });
    } catch (e) {
      console.error("reorder failed", e);
      results.push({ location: loc.name, error: e instanceof Error ? e.message : "failed" });
    }
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), results });
}
