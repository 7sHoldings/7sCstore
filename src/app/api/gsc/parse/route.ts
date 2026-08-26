import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { extractText, getDocumentProxy } from "unpdf";
import { parseGscOrderText, unitCost, normalizeUpc, type GscOrder } from "@/lib/vendors/gscOrder";

/**
 * Parse one or more GSC printable-order PDFs and return their line items.
 * Nothing is written here — the client reviews the summary, then saves.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 40;

export interface ParsedOrderPayload {
  fileName: string;
  orderId: string;
  customer: string | null;
  statedLineCount: number | null;
  statedApproxCost: number | null;
  parsedLineCount: number;
  sumLineCost: number;
  /** True when the parse reconciles with the document's own totals. */
  reconciles: boolean;
  warnings: string[];
  lines: (GscOrder["lines"][number] & { unitCost: number; upcNorm: string })[];
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!can(session.role, "enterPurchases")) {
    return NextResponse.json({ error: "You don't have permission to import vendor orders." }, { status: 403 });
  }

  let files: File[];
  try {
    const form = await req.formData();
    files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      const one = form.get("file");
      if (one instanceof File) files = [one];
    }
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }

  if (files.length === 0) return NextResponse.json({ error: "No files were uploaded." }, { status: 400 });
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Upload at most ${MAX_FILES} files at a time.` }, { status: 400 });
  }

  const orders: ParsedOrderPayload[] = [];
  const failures: { fileName: string; error: string }[] = [];

  for (const file of files) {
    try {
      if (file.size === 0) throw new Error("The file is empty.");
      if (file.size > MAX_BYTES) throw new Error("The file is larger than 25 MB.");

      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: true });
      const order = parseGscOrderText(text);

      const sumLineCost = round2(order.lines.reduce((s, l) => s + l.lineCost, 0));
      const countOk = order.statedLineCount == null || order.statedLineCount === order.lines.length;
      const costOk =
        order.statedApproxCost == null || Math.abs(sumLineCost - order.statedApproxCost) < 0.02;

      orders.push({
        fileName: file.name,
        orderId: order.orderId,
        customer: order.customer,
        statedLineCount: order.statedLineCount,
        statedApproxCost: order.statedApproxCost,
        parsedLineCount: order.lines.length,
        sumLineCost,
        reconciles: countOk && costOk,
        warnings: order.warnings,
        lines: order.lines.map((l) => ({ ...l, unitCost: unitCost(l), upcNorm: normalizeUpc(l.upc) })),
      });
    } catch (e) {
      failures.push({ fileName: file.name, error: e instanceof Error ? e.message : "Could not read this PDF." });
    }
  }

  if (orders.length === 0) {
    return NextResponse.json({ error: failures[0]?.error ?? "No orders could be read.", failures }, { status: 400 });
  }
  return NextResponse.json({ ok: true, orders, failures });
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
