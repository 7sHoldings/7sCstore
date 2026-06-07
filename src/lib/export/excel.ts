import ExcelJS from "exceljs";
import type { ReportDoc } from "../reportBuilder";

/** Render a ReportDoc to an .xlsx workbook buffer (FR-35). */
export async function reportToExcel(doc: ReportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FuelTrack";
  wb.created = new Date();

  const navy = "FF0A2540";
  const lightFill = "FFEFF4FF";

  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ width: 38 }, { width: 22 }];

  summary.mergeCells("A1:B1");
  const titleCell = summary.getCell("A1");
  titleCell.value = `FuelTrack — ${doc.title}`;
  titleCell.font = { size: 16, bold: true, color: { argb: navy } };

  summary.getCell("A2").value = `Period: ${doc.periodLabel}`;
  summary.getCell("A3").value = `Generated: ${doc.generatedAt}`;
  summary.getCell("A2").font = { color: { argb: "FF43474D" } };
  summary.getCell("A3").font = { color: { argb: "FF43474D" } };

  let row = 5;
  summary.getCell(`A${row}`).value = "Summary";
  summary.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: navy } };
  row++;
  for (const item of doc.summary) {
    summary.getCell(`A${row}`).value = item.label;
    summary.getCell(`B${row}`).value = item.value;
    summary.getCell(`B${row}`).alignment = { horizontal: "right" };
    if (row % 2 === 0) {
      summary.getCell(`A${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: lightFill } };
      summary.getCell(`B${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: lightFill } };
    }
    row++;
  }

  // One sheet per section.
  doc.sections.forEach((section, idx) => {
    const safeName = section.heading.replace(/[\\/?*[\]:]/g, "").slice(0, 28) || `Section ${idx + 1}`;
    const ws = wb.addWorksheet(safeName);
    ws.columns = section.columns.map(() => ({ width: 24 }));

    const header = ws.addRow(section.columns);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell, col) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
      cell.alignment = { horizontal: section.align?.[col - 1] === "right" ? "right" : "left" };
    });

    section.rows.forEach((r, i) => {
      const added = ws.addRow(r);
      added.eachCell((cell, col) => {
        cell.alignment = { horizontal: section.align?.[col - 1] === "right" ? "right" : "left" };
        if (i % 2 === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: lightFill } };
        }
      });
    });
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
