import { NextRequest, NextResponse } from "next/server";
import { SALES_TEMPLATE_CSV, EXPENSE_TEMPLATE_CSV } from "@/lib/csv";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type");
  const isExpenses = type === "expenses";
  const body = isExpenses ? EXPENSE_TEMPLATE_CSV : SALES_TEMPLATE_CSV;
  const filename = isExpenses ? "7scstores_expenses_template.csv" : "7scstores_sales_template.csv";
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
