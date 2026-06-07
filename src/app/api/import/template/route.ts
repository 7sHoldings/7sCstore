import { NextResponse } from "next/server";
import { SALES_TEMPLATE_CSV } from "@/lib/csv";

export const runtime = "nodejs";

export async function GET() {
  return new NextResponse(SALES_TEMPLATE_CSV, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="fueltrack_sales_template.csv"',
    },
  });
}
