import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { syncRange } from "@/lib/integrations/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Backfill one chunk of historical POS data. The client calls this repeatedly
 * for successive date windows so each request stays within the function time
 * budget. Idempotent per range (syncRange replaces existing POS rows).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(session.role, "viewAll")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const locationId = await getActiveLocationId();
  if (!locationId) return NextResponse.json({ error: "No active location" }, { status: 400 });

  let body: { from?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!body.from || !body.to) {
    return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    const from = new Date(body.from + "T00:00:00");
    const to = new Date(body.to + "T00:00:00");
    const imported = await syncRange(locationId, from, to);
    return NextResponse.json({ imported });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Backfill chunk failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
