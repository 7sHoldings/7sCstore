import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { readTabularFile } from "@/lib/tabular";
import { parseSalesExport, type SalesRow } from "@/lib/vendors/salesImport";

/**
 * Import units sold from a Modisoft Inventory export, for a stated period.
 *
 * The period has to be given because the file itself doesn't say what range it
 * covers, and a sales figure without its timespan is meaningless — 400 units is
 * a busy week or a quiet quarter depending on it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!can(session.role, "enterPurchases")) {
    return NextResponse.json({ error: "You don't have permission to import sales." }, { status: 403 });
  }
  const locationId = await getActiveLocationId();
  if (!locationId) return NextResponse.json({ error: "No location assigned." }, { status: 400 });

  let file: File;
  let fromStr: string;
  let toStr: string;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    file = f;
    fromStr = String(form.get("from") ?? "");
    toStr = String(form.get("to") ?? "");
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }

  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T00:00:00");
  if (!fromStr || !toStr || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "Give the dates this export covers." }, { status: 400 });
  }
  if (to <= from) return NextResponse.json({ error: "The end date must be after the start date." }, { status: 400 });

  const periodDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  if (periodDays > 400) {
    return NextResponse.json({ error: "That period is over a year — use a shorter range." }, { status: 400 });
  }

  try {
    const table = await readTabularFile(file);
    const parsed = parseSalesExport(table);
    if (parsed.rows.length === 0) {
      return NextResponse.json(
        { error: `No sales found in that file. Read the "${parsed.matchedColumn}" column across ${parsed.totalRows} rows and every one was zero.` },
        { status: 400 }
      );
    }

    // Replace any previous import for exactly this period.
    // The unique key is (location, upc, periodStart), so a re-import of the same
    // start date replaces the old rows whatever length it claimed.
    await prisma.productDemand.deleteMany({ where: { locationId, periodStart: from } });
    const measuredAt = new Date();
    for (let i = 0; i < parsed.rows.length; i += 1000) {
      await prisma.productDemand.createMany({
        data: parsed.rows.slice(i, i + 1000).map((r: SalesRow) => ({
          locationId, upcNorm: r.upcNorm, periodStart: from, periodDays,
          soldUnits: r.soldUnits, measuredAt,
        })),
        skipDuplicates: true,
      });
    }

    // How many of these products do we actually buy from GSC?
    const [{ matched }] = await prisma.$queryRaw<{ matched: number }[]>`
      SELECT COUNT(DISTINCT d."upcNorm")::int AS matched
      FROM "ProductDemand" d
      WHERE d."locationId" = ${locationId} AND d."periodStart" = ${from} AND d."periodDays" = ${periodDays}
        AND EXISTS (
          SELECT 1 FROM "VendorOrderLine" v
          WHERE v."locationId" = ${locationId} AND v.vendor = 'GSC' AND v."upcNorm" = d."upcNorm"
        )
    `;

    return NextResponse.json({
      ok: true,
      products: parsed.rows.length,
      matchedToGsc: matched,
      periodDays,
      column: parsed.matchedColumn,
      zeroSales: parsed.zeroSales,
      skipped: parsed.skipped,
      totalRows: parsed.totalRows,
    });
  } catch (e) {
    console.error("sales import failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not read that file." },
      { status: 400 }
    );
  }
}
