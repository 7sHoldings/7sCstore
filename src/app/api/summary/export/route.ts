import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { todayISO } from "@/lib/day";
import { defaultMonth, delta, isMonth, monthLabel } from "@/lib/compare";
import { buildMonthsReport } from "@/lib/monthsReport";

/**
 * Monthly Summary as an Excel workbook: one sheet with every section stacked
 * (January → selected month, year total, projections), coloured like the page,
 * and one sheet per section for sorting/filtering.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const GREEN = "FFD5F5E3";
const RED = "FFFDE0DD";
const PROJ = "FFFFF1D6";
const HEAD = "FFE8EEF8";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return NextResponse.json({ error: "No access." }, { status: 403 });
  }
  const loc = await getActiveLocationId();
  if (!loc) return NextResponse.json({ error: "No location." }, { status: 400 });

  const today = todayISO();
  const m = req.nextUrl.searchParams.get("month");
  const month = isMonth(m) ? m : defaultMonth(today);
  const f = req.nextUrl.searchParams.get("from");
  const from = isMonth(f) && f <= month ? f : `${month.slice(0, 4)}-01`;
  const [report, location] = await Promise.all([
    buildMonthsReport(loc, from, month, today),
    prisma.location.findUnique({ where: { id: loc }, select: { name: true } }),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "7sCstores";
  const monthHeads = report.months.map((x) => (x.partial ? `${x.label} (to date)` : x.label));
  const projHeads = [report.projLabels.current, report.projLabels.next].filter(Boolean) as string[];

  const writeSection = (ws: ExcelJS.Worksheet, s: (typeof report.sections)[number], withTitle: boolean) => {
    if (withTitle) {
      const t = ws.addRow([s.title]);
      t.font = { bold: true, size: 13 };
    }
    const hasProj = s.rows.some((r) => r.proj);
    const head = ws.addRow(["", ...monthHeads, "Year total", ...(hasProj ? projHeads : [])]);
    head.font = { bold: true };
    head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } }));
    if (s.empty) {
      ws.addRow([s.empty]);
      return;
    }
    for (const r of s.rows) {
      if (r.section) ws.addRow([r.section]).font = { italic: true, color: { argb: "FF555555" } };
      const total = r.values.reduce((a, b) => a + b, 0);
      const proj = hasProj
        ? [...(report.projLabels.current ? [r.proj?.current ?? null] : []), r.proj?.next ?? null]
        : [];
      const totalCell = r.totalValue !== undefined ? r.totalValue : r.noTotal ? null : total;
      const row = ws.addRow([(r.indent ? "    " : "") + r.label, ...r.values.map((v) => v || null), totalCell, ...proj]);
      if (r.strong) row.font = { bold: true };
      const fmt = r.unit === "pct" ? '0.0"%"' : r.unit === "gal" || r.unit === "units" ? "#,##0" : '"$"#,##0.00;[Red]-"$"#,##0.00';
      row.eachCell((c, col) => {
        if (col > 1) c.numFmt = fmt;
      });
      // Colour each month against the month before (not the running month).
      // Percent rows with a target (gross profit ≥ 30%) are coloured against it.
      r.values.forEach((v, i) => {
        if (r.threshold !== undefined) {
          if (!v) return;
          const ok = (v >= r.threshold) === (r.good !== false);
          row.getCell(i + 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ok ? GREEN : RED } };
          return;
        }
        if (i === 0 || r.neutral || report.months[i].partial) return;
        const tone = delta(v, r.values[i - 1], r.good !== false).tone;
        if (tone === "good" || tone === "bad") {
          row.getCell(i + 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone === "good" ? GREEN : RED } };
        }
      });
      for (let k = 0; k < proj.length; k++) {
        const c = row.getCell(report.months.length + 3 + k);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PROJ } };
        c.font = { italic: true, bold: !!r.strong };
      }
    }
  };

  const setWidths = (ws: ExcelJS.Worksheet) => {
    ws.getColumn(1).width = 34;
    for (let i = 2; i <= report.months.length + 5; i++) ws.getColumn(i).width = 14;
  };

  // Sheet 1: everything stacked — the one to share.
  const all = wb.addWorksheet("Monthly Summary", { views: [{ state: "frozen", xSplit: 1 }] });
  all.addRow([`Monthly Summary — ${location?.name ?? ""} — ${monthLabel(report.months[0].ym)} to ${monthLabel(month)}`]).font = { bold: true, size: 15 };
  all.addRow([`Green = better than the month before, red = worse (for expenses, spending more is red). Projected columns are shaded.`]).font = { italic: true, color: { argb: "FF555555" } };
  all.addRow([]);
  for (const s of report.sections) {
    writeSection(all, s, true);
    all.addRow([]);
  }
  setWidths(all);

  // One sheet per section.
  for (const s of report.sections) {
    const ws = wb.addWorksheet(s.title.split(" —")[0].replace(/\s*\/\s*/g, " & ").replace(/[\\*?:[\]]/g, "").slice(0, 31), { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
    writeSection(ws, s, false);
    setWidths(ws);
  }

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Monthly-Summary-${month}.xlsx"`,
    },
  });
}
