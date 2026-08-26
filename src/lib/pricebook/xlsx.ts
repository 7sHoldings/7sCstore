import "server-only";
import ExcelJS from "exceljs";
import { parsePriceBookTable, type ParseResult } from "./parse";

/**
 * Read the first worksheet of an .xlsx price-book export into rows.
 *
 * exceljs returns `row.values` as a 1-based sparse array (index 0 is padding),
 * so it is sliced back to a normal 0-based row before parsing.
 */
export async function parsePriceBookXLSX(buf: ArrayBuffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error("That workbook has no worksheets.");

  const table: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[];
    table.push(Array.from(values).slice(1));
  });

  return parsePriceBookTable(table);
}

/** Route a file to the right reader by extension. */
export async function parsePriceBookFile(name: string, buf: ArrayBuffer): Promise<ParseResult> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return parsePriceBookXLSX(buf);
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    const { parsePriceBookCSV } = await import("./parse");
    return parsePriceBookCSV(new TextDecoder().decode(buf));
  }
  throw new Error("Unsupported file type. Upload the .xlsx export or a .csv.");
}
