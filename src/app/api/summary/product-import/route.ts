import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { isMonth } from "@/lib/compare";
import { readTabularFile } from "@/lib/tabular";
import { parseSalesExport } from "@/lib/vendors/salesImport";

/**
 * Upload one month of product sales from a Modisoft Inventory (item-wise)
 * export that was run for exactly that month. Replaces any earlier upload for
 * the same month. Used by the Monthly Summary's brand/product history.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!can(session.role, "viewProfit") && !can(session.role, "enterPurchases")) {
    return NextResponse.json({ error: "You don't have permission to upload sales." }, { status: 403 });
  }
  const locationId = await getActiveLocationId();
  if (!locationId) return NextResponse.json({ error: "No location assigned." }, { status: 400 });

  let file: File;
  let ym: string;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    file = f;
    ym = String(form.get("month") ?? "");
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }
  if (!isMonth(ym)) return NextResponse.json({ error: "Pick the month this file covers." }, { status: 400 });

  try {
    const parsed = parseSalesExport(await readTabularFile(file));
    if (/read as a sold counter/.test(parsed.matchedColumn)) {
      return NextResponse.json(
        { error: 'This file has no "Sold Qty" column, only the running stock counter, which can\'t be split into months. In Modisoft, run the Inventory export for that month with the Sold Qty column turned on.' },
        { status: 400 }
      );
    }
    if (parsed.rows.length === 0) {
      return NextResponse.json({ error: `No sales found in that file (read the "${parsed.matchedColumn}" column).` }, { status: 400 });
    }
    await prisma.$transaction([
      prisma.productMonthSales.deleteMany({ where: { locationId, ym } }),
      prisma.productMonthSales.createMany({
        data: parsed.rows.map((r) => ({ locationId, ym, upcNorm: r.upcNorm, units: r.soldUnits })),
        skipDuplicates: true,
      }),
    ]);
    const units = parsed.rows.reduce((s, r) => s + r.soldUnits, 0);
    return NextResponse.json({ ok: true, products: parsed.rows.length, units: Math.round(units), column: parsed.matchedColumn });
  } catch (e) {
    console.error("product month import failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read that file." }, { status: 400 });
  }
}
