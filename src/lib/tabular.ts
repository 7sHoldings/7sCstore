import "server-only";
import { parseCSV } from "./csv";

/**
 * Read an uploaded spreadsheet into rows of plain strings, from either a POS
 * `.xlsx` export or a `.csv`.
 *
 * The Modisoft Inventory export is a real .xlsx, so requiring a manual
 * "save as CSV" step before every import is friction the owner shouldn't carry.
 * Every cell comes back as trimmed text, which is exactly the shape the CSV
 * importers already expect — so they gain xlsx support without changing how
 * they parse anything.
 */
export async function readTabularFile(file: File): Promise<string[][]> {
  const name = (file.name || "").toLowerCase();

  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    return readXlsx(await file.arrayBuffer());
  }
  return parseCSV(await file.text());
}

/** True when this filename will be read as a workbook rather than as CSV. */
export function isSpreadsheet(name: string): boolean {
  const n = (name || "").toLowerCase();
  return n.endsWith(".xlsx") || n.endsWith(".xlsm");
}

async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  // Imported lazily so the CSV path doesn't pull exceljs into the function.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error("That workbook has no worksheets.");

  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    // exceljs hands back a 1-based sparse array (index 0 is padding).
    const values = Array.from(row.values as unknown[]).slice(1);
    rows.push(values.map(cellText));
  });

  // Match parseCSV: drop rows that are entirely blank.
  return rows.filter((r) => r.some((c) => c !== ""));
}

/** Flatten any exceljs cell value — rich text, formula results, links — to text. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.trim();
    if (Array.isArray(o.richText)) {
      return o.richText.map((r) => cellText((r as Record<string, unknown>).text)).join("").trim();
    }
    if ("result" in o) return cellText(o.result);
    if (typeof o.hyperlink === "string") return o.hyperlink.trim();
  }
  return String(v).trim();
}
