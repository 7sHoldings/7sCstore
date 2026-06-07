import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runSync } from "@/lib/integrations/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nightly POS sync, triggered by Vercel Cron (see vercel.json — 06:30 UTC =
 * 12:30 AM CST). Pulls each location's data since the last successful sync.
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

  const locations = await prisma.location.findMany();
  const results: { location: string; imported?: number; error?: string }[] = [];

  for (const loc of locations) {
    try {
      const r = await runSync(loc.id);
      results.push({ location: loc.name, imported: r.imported });
    } catch (e) {
      results.push({ location: loc.name, error: e instanceof Error ? e.message : "failed" });
    }
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), results });
}
