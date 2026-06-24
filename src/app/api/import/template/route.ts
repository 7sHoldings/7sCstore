import { NextRequest, NextResponse } from "next/server";
import { SALES_TEMPLATE_CSV, EXPENSE_TEMPLATE_CSV, DAILY_SALES_TEMPLATE_CSV, RECON_TEMPLATE_CSV, HOUSE_TEMPLATE_CSV, MONEY_INCOMING_TEMPLATE_CSV, SUMMARY_TEMPLATE_CSV } from "@/lib/csv";

export const runtime = "nodejs";

const TEMPLATES: Record<string, { csv: string; filename: string }> = {
  expenses: { csv: EXPENSE_TEMPLATE_CSV, filename: "7scstores_expenses_template.csv" },
  daily: { csv: DAILY_SALES_TEMPLATE_CSV, filename: "7scstores_daily_sales_template.csv" },
  recon: { csv: RECON_TEMPLATE_CSV, filename: "7scstores_daily_reconciliation_template.csv" },
  house: { csv: HOUSE_TEMPLATE_CSV, filename: "7scstores_house_accounts_template.csv" },
  income: { csv: MONEY_INCOMING_TEMPLATE_CSV, filename: "7scstores_money_incoming_template.csv" },
  summary: { csv: SUMMARY_TEMPLATE_CSV, filename: "7scstores_monthly_summary_template.csv" },
};

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") ?? "";
  const t = TEMPLATES[type] ?? { csv: SALES_TEMPLATE_CSV, filename: "7scstores_sales_template.csv" };
  return new NextResponse(t.csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${t.filename}"`,
    },
  });
}
