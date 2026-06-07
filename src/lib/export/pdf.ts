import PDFDocument from "pdfkit";
import type { ReportDoc, ReportSection } from "../reportBuilder";

const NAVY = "#0a2540";
const GREY = "#43474d";
const LIGHT = "#eff4ff";

/** Render a ReportDoc to a PDF buffer (FR-35). Pure pdfkit, no browser needed. */
export async function reportToPdf(doc: ReportDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const pdf = new PDFDocument({ size: "A4", margin: 48 });
      const chunks: Buffer[] = [];
      pdf.on("data", (c) => chunks.push(c as Buffer));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);

      const pageW = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
      const left = pdf.page.margins.left;

      // Header band
      pdf.rect(0, 0, pdf.page.width, 70).fill(NAVY);
      pdf.fillColor("#ffffff").fontSize(20).font("Helvetica-Bold").text("FuelTrack", left, 22);
      pdf.fontSize(10).font("Helvetica").fillColor("#b0c8eb").text("Gas Station Business Reporting", left, 46);
      pdf.moveDown(2);

      pdf.fillColor(NAVY).fontSize(16).font("Helvetica-Bold").text(doc.title, left, 90);
      pdf.fillColor(GREY).fontSize(10).font("Helvetica");
      pdf.text(`Period: ${doc.periodLabel}`, left, 112);
      pdf.text(`Generated: ${doc.generatedAt}`, left, 126);

      let y = 150;

      // Summary box
      pdf.fillColor(NAVY).fontSize(12).font("Helvetica-Bold").text("Summary", left, y);
      y += 18;
      const colW = pageW / 2;
      doc.summary.forEach((item, i) => {
        const x = left + (i % 2) * colW;
        if (i % 2 === 0 && i > 0) y += 18;
        if (Math.floor(i / 2) % 2 === 0) {
          pdf.rect(x, y - 2, colW - 6, 16).fill(LIGHT);
        }
        pdf.fillColor(GREY).fontSize(9).font("Helvetica").text(item.label, x + 4, y, { width: colW - 90, continued: false });
        pdf.fillColor(NAVY).font("Helvetica-Bold").text(item.value, x + colW - 90, y, { width: 80, align: "right" });
      });
      y += 28;

      for (const section of doc.sections) {
        y = drawSection(pdf, section, left, y, pageW);
        y += 16;
      }

      // Footer
      pdf.fontSize(8).fillColor(GREY).font("Helvetica").text(
        "Confidential — FuelTrack reporting suite",
        left,
        pdf.page.height - 40,
        { width: pageW, align: "center" }
      );

      pdf.end();
    } catch (e) {
      reject(e as Error);
    }
  });
}

function drawSection(
  pdf: PDFKit.PDFDocument,
  section: ReportSection,
  left: number,
  startY: number,
  pageW: number
): number {
  let y = startY;
  const bottom = pdf.page.height - pdf.page.margins.bottom;

  const ensure = (needed: number) => {
    if (y + needed > bottom) {
      pdf.addPage();
      y = pdf.page.margins.top;
    }
  };

  ensure(40);
  pdf.fillColor(NAVY).fontSize(12).font("Helvetica-Bold").text(section.heading, left, y);
  y += 18;

  const cols = section.columns.length;
  const colW = pageW / cols;
  const rowH = 18;

  // Header row
  pdf.rect(left, y, pageW, rowH).fill(NAVY);
  pdf.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
  section.columns.forEach((c, i) => {
    const align = section.align?.[i] === "right" ? "right" : "left";
    pdf.text(c, left + i * colW + 4, y + 5, { width: colW - 8, align });
  });
  y += rowH;

  // Data rows
  pdf.font("Helvetica").fontSize(9);
  section.rows.forEach((r, ri) => {
    ensure(rowH);
    if (y === pdf.page.margins.top) {
      // redraw header after page break
      pdf.rect(left, y, pageW, rowH).fill(NAVY);
      pdf.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
      section.columns.forEach((c, i) => {
        const align = section.align?.[i] === "right" ? "right" : "left";
        pdf.text(c, left + i * colW + 4, y + 5, { width: colW - 8, align });
      });
      y += rowH;
      pdf.font("Helvetica").fontSize(9);
    }
    if (ri % 2 === 1) pdf.rect(left, y, pageW, rowH).fill(LIGHT);
    pdf.fillColor("#0b1c30");
    r.forEach((cell, i) => {
      const align = section.align?.[i] === "right" ? "right" : "left";
      pdf.text(String(cell), left + i * colW + 4, y + 5, { width: colW - 8, align });
    });
    y += rowH;
  });

  return y;
}
