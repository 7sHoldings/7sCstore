import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = ["FUEL", "STORE", "FOOD_DRINK", "TOBACCO", "LOTTERY", "OTHER"];

/** One CSV field, quoted if it contains a comma/quote/newline. */
function cell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Export the current inventory view as a CSV for bulk price editing. Edit the
 * `newRetail` column in Excel, then re-import via Import → "Import Price
 * Updates" to push the new prices to the POS.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(session.role, "enterPurchases")) return new NextResponse("Forbidden", { status: 403 });
  const loc = await getActiveLocationId();
  if (!loc) return new NextResponse("No location", { status: 400 });

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() || "";
  const cat = CATEGORIES.includes(sp.get("cat") || "") ? sp.get("cat")! : "";
  const dept = sp.get("dept")?.trim() || "";

  const where = {
    locationId: loc,
    ...(cat ? { category: cat as never } : {}),
    ...(dept ? { department: dept } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { upc: { contains: q } }] } : {}),
  };

  const products = await prisma.product.findMany({
    where,
    orderBy: [{ department: "asc" }, { name: "asc" }],
    select: {
      posItemId: true, upc: true, name: true, department: true, category: true,
      currentCost: true, sellingPrice: true, posDeptId: true,
    },
  });

  const headers = ["posItemId", "upc", "name", "department", "category", "unitCost", "retail", "newRetail", "pushable"];
  const lines = [headers.join(",")];
  for (const p of products) {
    lines.push([
      cell(p.posItemId ?? ""),
      cell(p.upc ?? ""),
      cell(p.name),
      cell(p.department ?? ""),
      cell(p.category),
      cell(p.currentCost.toFixed(2)),
      cell(p.sellingPrice.toFixed(2)),
      cell(p.sellingPrice.toFixed(2)), // newRetail prefilled = current; edit this column
      cell(p.posItemId && p.posDeptId ? "yes" : "no"),
    ].join(","));
  }
  const csv = lines.join("\n") + "\n";

  const scope = dept || cat || "all";
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="7scstores_prices_${scope}_${stamp}.csv"`,
    },
  });
}
