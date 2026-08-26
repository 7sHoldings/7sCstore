import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";

/**
 * Download the draft as CSV for keying into the vendor's portal. Columns lead
 * with the vendor SKU and case count, which is all the portal needs.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(session.role, "enterPurchases")) return new NextResponse("Forbidden", { status: 403 });
  const locationId = await getActiveLocationId();
  if (!locationId) return new NextResponse("No location", { status: 400 });

  const id = req.nextUrl.searchParams.get("id") ?? undefined;
  const po = await prisma.purchaseOrder.findFirst({
    where: id ? { id, locationId } : { locationId, vendor: "GSC", status: "DRAFT" },
    include: { lines: { orderBy: { description: "asc" } } },
  });
  if (!po) return new NextResponse("No order found", { status: 404 });

  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = ["sku", "cases", "description", "upc", "unitsPerCase", "caseCost", "lineCost", "weeklyUnits", "basis"];
  const body = po.lines
    .filter((l) => l.cases > 0)
    .map((l) =>
      [
        l.sku, l.cases, l.description, l.upcNorm, l.unitsPerCase,
        l.caseCost.toFixed(2), (l.cases * l.caseCost).toFixed(2),
        l.weeklyUnits, l.basis,
      ].map(esc).join(",")
    );

  const csv = [header.join(","), ...body].join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${po.vendor}-order-${stamp}.csv"`,
    },
  });
}
