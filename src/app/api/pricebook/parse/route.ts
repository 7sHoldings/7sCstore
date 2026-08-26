import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { parsePriceBookFile } from "@/lib/pricebook/xlsx";

/**
 * Parse an uploaded price-book export and return the normalized rows plus a
 * preview. Parsing happens here rather than in a server action so a large
 * workbook streams in as multipart instead of a serialized action payload.
 * Nothing is written to the database — the client applies rows in batches.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;
/** Cap the issue list sent to the browser; the count is reported in full. */
const MAX_ISSUES = 200;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!can(session.role, "enterPurchases")) {
    return NextResponse.json({ error: "You don't have permission to import a price book." }, { status: 403 });
  }

  let file: File;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    file = f;
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }

  if (file.size === 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That file is larger than 25 MB." }, { status: 413 });
  }

  try {
    const result = await parsePriceBookFile(file.name, await file.arrayBuffer());
    return NextResponse.json({
      ok: true,
      fileName: file.name,
      headers: result.headers,
      mapping: result.mapping,
      stats: result.stats,
      issues: result.issues.slice(0, MAX_ISSUES),
      issuesTotal: result.issues.length,
      rows: result.rows,
    });
  } catch (e) {
    console.error("price book parse failed", e);
    const message = e instanceof Error ? e.message : "Could not read that file.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
