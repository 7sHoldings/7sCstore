/**
 * Parser for a POS price-book / inventory export (Modisoft "Inventory" export
 * today, but header-driven so a differently-ordered or renamed export still
 * lands correctly).
 *
 * Real-world exports are messy. From a 16,230-row production export: ~4% of
 * scan codes are not standard barcodes (`.`, `.-538`, even a URL), 96 items
 * carry no retail price, and cost is empty on 99.9% of rows. So this parser
 * never rejects a file for being untidy — it normalizes what it can, flags the
 * rest as issues, and lets the import screen show the owner what it found.
 */

import { parseCSV } from "../csv";
import { mapDeptToCategory } from "../integrations/modiMap";
import { money } from "../calc";
import type { NormalizedSale } from "../integrations/types";

export type ProductCategory = NormalizedSale["category"];

export interface PriceBookRow {
  /** POS scan code — the join key to vendor invoices and UPC lookups. */
  upc: string;
  name: string;
  department: string | null;
  category: ProductCategory;
  /** Shelf price. 0 means "the POS has no price", not "free". */
  sellingPrice: number;
  /** 0 means "unknown" — the importer must never write it over a real cost. */
  currentCost: number;
  size: string | null;
  unitsPerCase: number | null;
  posItemCode: string | null;
}

export type IssueCode =
  | "NO_SCAN_CODE"
  | "NON_STANDARD_CODE"
  | "NO_DESCRIPTION"
  | "NO_RETAIL"
  | "DUPLICATE_CODE";

export interface ParseIssue {
  /** 1-based row number in the source file, counting the header. */
  row: number;
  code: IssueCode;
  message: string;
  value?: string;
}

export interface ParseStats {
  totalRows: number;
  imported: number;
  skipped: number;
  duplicates: number;
  nonStandardCodes: number;
  missingRetail: number;
  withCost: number;
  departments: number;
}

export interface ParseResult {
  rows: PriceBookRow[];
  issues: ParseIssue[];
  stats: ParseStats;
  /** Header names as found, so the UI can show what it matched. */
  headers: string[];
  /** Canonical field → matched header, for the "columns detected" panel. */
  mapping: Partial<Record<Field, string>>;
}

type Field =
  | "upc"
  | "name"
  | "department"
  | "sellingPrice"
  | "currentCost"
  | "size"
  | "unitsPerCase"
  | "posItemCode";

/**
 * Accepted header spellings per field. Compared after lowercasing and stripping
 * every non-alphanumeric character, so "Units Per Case" == "units_per_case".
 */
const HEADER_ALIASES: Record<Field, string[]> = {
  upc: ["scancode", "upc", "barcode", "upccode", "itemupc", "scan"],
  name: ["description", "itemname", "name", "product", "productname", "itemdescription"],
  department: ["department", "dept", "deptname", "departmentname", "category"],
  sellingPrice: ["retail", "price", "sellingprice", "sellprice", "retailprice", "unitretail"],
  currentCost: ["cost", "unitcost", "currentcost", "itemcost"],
  size: ["size", "packsize", "itemsize"],
  unitsPerCase: ["unitspercase", "casepack", "pack", "packqty", "unitscase"],
  posItemCode: ["itemcode", "posid", "itemid", "sku"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A plausible retail barcode: UPC-E/UPC-A/EAN-13/GTIN-14 all live in 8–14 digits. */
const STANDARD_CODE = /^\d{8,14}$/;

/** exceljs and CSV both hand back odd shapes; flatten anything to plain text. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Hyperlink cell (one production row has a URL as its scan code).
    if (typeof o.text === "string") return o.text.trim();
    // Rich text runs.
    if (Array.isArray(o.richText)) {
      return o.richText.map((r) => cellText((r as Record<string, unknown>).text)).join("").trim();
    }
    // Formula cell — use the cached result.
    if ("result" in o) return cellText(o.result);
    if (typeof o.hyperlink === "string") return o.hyperlink.trim();
  }
  return String(v).trim();
}

function toNumber(v: unknown): number {
  const t = cellText(v).replace(/[$,\s]/g, "");
  if (!t) return 0;
  const n = Number(t);
  return isFinite(n) && n > 0 ? n : 0;
}

/** Build canonical field → column index from the header row. */
function mapHeaders(headerRow: unknown[]): {
  index: Partial<Record<Field, number>>;
  mapping: Partial<Record<Field, string>>;
  headers: string[];
} {
  const headers = headerRow.map((h) => cellText(h));
  const index: Partial<Record<Field, number>> = {};
  const mapping: Partial<Record<Field, string>> = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [Field, string[]][]) {
    const i = headers.findIndex((h) => aliases.includes(norm(h)));
    if (i >= 0) {
      index[field] = i;
      mapping[field] = headers[i];
    }
  }
  return { index, mapping, headers };
}

/**
 * Normalize a table (header row + data rows) into price-book rows.
 * Later rows win on duplicate scan codes — an export lists the newest state last.
 */
export function parseTable(table: unknown[][]): ParseResult {
  const issues: ParseIssue[] = [];
  if (table.length === 0) {
    return {
      rows: [],
      issues: [],
      headers: [],
      mapping: {},
      stats: emptyStats(),
    };
  }

  const { index, mapping, headers } = mapHeaders(table[0]);
  if (index.upc === undefined || index.name === undefined) {
    throw new Error(
      "Could not find a scan-code and description column. Expected headers like " +
        '"Scan Code" and "Description" — found: ' +
        (headers.filter(Boolean).join(", ") || "(none)")
    );
  }

  const get = (row: unknown[], f: Field): unknown =>
    index[f] === undefined ? undefined : row[index[f]!];

  const byUpc = new Map<string, PriceBookRow>();
  const dataRows = table.slice(1);
  let duplicates = 0;
  let skipped = 0;
  let nonStandardCodes = 0;
  let missingRetail = 0;

  dataRows.forEach((row, i) => {
    const lineNo = i + 2; // +1 for 0-index, +1 for the header row
    const upc = cellText(get(row, "upc"));

    if (!upc) {
      skipped++;
      issues.push({ row: lineNo, code: "NO_SCAN_CODE", message: "No scan code — cannot match this item." });
      return;
    }

    let name = cellText(get(row, "name")).replace(/\s+/g, " ");
    if (!name) {
      issues.push({ row: lineNo, code: "NO_DESCRIPTION", message: "No description; using the scan code as the name.", value: upc });
      name = upc;
    }

    if (!STANDARD_CODE.test(upc)) {
      nonStandardCodes++;
      issues.push({ row: lineNo, code: "NON_STANDARD_CODE", message: "Not a standard 8–14 digit barcode — it will not match vendor invoices.", value: upc });
    }

    const sellingPrice = money(toNumber(get(row, "sellingPrice")));
    if (sellingPrice <= 0) {
      missingRetail++;
      issues.push({ row: lineNo, code: "NO_RETAIL", message: "No retail price in the export; the existing price is kept.", value: name });
    }

    const department = cellText(get(row, "department")) || null;
    const unitsRaw = toNumber(get(row, "unitsPerCase"));

    const parsed: PriceBookRow = {
      upc,
      name,
      department,
      category: mapDeptToCategory(department ?? ""),
      sellingPrice,
      currentCost: money(toNumber(get(row, "currentCost"))),
      size: cellText(get(row, "size")) || null,
      unitsPerCase: unitsRaw > 0 ? unitsRaw : null,
      posItemCode: cellText(get(row, "posItemCode")) || null,
    };

    if (byUpc.has(upc)) {
      duplicates++;
      issues.push({ row: lineNo, code: "DUPLICATE_CODE", message: "Scan code appears more than once; the last row wins.", value: upc });
    }
    byUpc.set(upc, parsed);
  });

  const rows = [...byUpc.values()];
  return {
    rows,
    issues,
    headers,
    mapping,
    stats: {
      totalRows: dataRows.length,
      imported: rows.length,
      skipped,
      duplicates,
      nonStandardCodes,
      missingRetail,
      withCost: rows.filter((r) => r.currentCost > 0).length,
      departments: new Set(rows.map((r) => r.department).filter(Boolean)).size,
    },
  };
}

/**
 * Parse a table whose header may not be the very first row — some exports put a
 * title or a store name above it. Tries the first few offsets before giving up.
 */
export function parsePriceBookTable(table: unknown[][]): ParseResult {
  let lastErr: unknown = new Error("The file has no rows.");
  for (let skip = 0; skip < Math.min(5, table.length); skip++) {
    try {
      return parseTable(table.slice(skip));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Parse a .csv / .tsv price book. */
export function parsePriceBookCSV(text: string): ParseResult {
  return parsePriceBookTable(parseCSV(text) as unknown[][]);
}

function emptyStats(): ParseStats {
  return {
    totalRows: 0,
    imported: 0,
    skipped: 0,
    duplicates: 0,
    nonStandardCodes: 0,
    missingRetail: 0,
    withCost: 0,
    departments: 0,
  };
}
