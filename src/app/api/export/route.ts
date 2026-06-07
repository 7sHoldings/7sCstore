import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { rangeFor, customRange, type PeriodKey } from "@/lib/period";
import { buildReport, REPORT_META, type ReportType } from "@/lib/reportBuilder";
import { reportToExcel } from "@/lib/export/excel";
import { reportToPdf } from "@/lib/export/pdf";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(session.role, "exportReports")) {
    return new NextResponse("Forbidden — your role can't export reports.", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const type = (sp.get("type") ?? "monthly_pl") as ReportType;
  const format = (sp.get("format") ?? "pdf").toLowerCase();
  if (!REPORT_META[type]) return new NextResponse("Unknown report type", { status: 400 });

  const period = (sp.get("period") as PeriodKey) || "mtd";
  const from = sp.get("from");
  const to = sp.get("to");
  const range = from && to ? customRange(from, to) : rangeFor(period);

  const doc = await buildReport(type, range, session.locationId ?? undefined);
  const filenameBase = `${type}_${new Date().toISOString().slice(0, 10)}`;

  await logAudit({
    userId: session.userId,
    action: "EXPORT",
    entity: "Report",
    entityId: type,
    after: { format, period: range.label },
  });

  if (format === "excel" || format === "xlsx") {
    const buf = await reportToExcel(doc);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
      },
    });
  }

  const buf = await reportToPdf(doc);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filenameBase}.pdf"`,
    },
  });
}
