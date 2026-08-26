import { normalizeUpc } from "./gscOrder";

/**
 * Reads units sold out of a Modisoft Inventory export.
 *
 * Why an upload rather than a live pull: the reporting site sits behind a
 * Cloudflare challenge whose clearance cookie is bound to the browser that
 * solved it, so a copied session dies the moment it is replayed from a server.
 * The export is the same data by a route that always works — the owner already
 * downloads it for the price book.
 *
 * The export's own header row is what we key on, so column ORDER can change
 * without breaking the import. Only the names matter.
 */

export interface SalesRow {
  upcNorm: string;
  soldUnits: number;
  name: string;
}

export interface SalesParse {
  rows: SalesRow[];
  /** Header names as found, for error messages. */
  headers: string[];
  /** Which column the sold quantity was read from. */
  matchedColumn: string;
  /** Data rows examined (excludes the header). */
  totalRows: number;
  /** Products present in the file but with no sales in the period. */
  zeroSales: number;
  /** Rows dropped for having no usable scan code. */
  skipped: number;
}

/** Column names that carry units sold, best first. */
const SOLD_COLUMNS = ["sold qty", "soldqty", "qty sold", "sold", "units sold", "sales qty"];

/** Column names that carry the scan code / UPC, best first. */
const CODE_COLUMNS = ["scan code", "scancode", "upc", "mapped scan code", "item code", "barcode"];

/** Column names that carry the product description, best first. */
const NAME_COLUMNS = ["description", "product", "name", "item name", "item description"];

/**
 * The POS does not maintain stock: on-hand decrements from zero as items sell,
 * so a large NEGATIVE "Current Qty" is a units-sold counter in disguise. That
 * is the fallback when the export was taken without the Sold Qty column.
 */
const ONHAND_COLUMNS = ["current qty", "currentqty", "qty on hand", "on hand", "quantity"];

export function parseSalesExport(table: string[][]): SalesParse {
  if (table.length < 2) {
    throw new Error("That file has a header but no data rows.");
  }

  const headers = table[0].map((h) => (h ?? "").trim());
  const lower = headers.map((h) => h.toLowerCase());
  const find = (names: string[]) => {
    for (const n of names) {
      const i = lower.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const codeIdx = find(CODE_COLUMNS);
  if (codeIdx === -1) {
    throw new Error(
      `No scan-code column found. Expected one of ${CODE_COLUMNS.map((c) => `"${c}"`).join(", ")} — this file has ${headers.map((h) => `"${h}"`).join(", ")}.`
    );
  }

  const nameIdx = find(NAME_COLUMNS);
  let soldIdx = find(SOLD_COLUMNS);
  let matchedColumn = soldIdx >= 0 ? headers[soldIdx] : "";
  let negate = false;

  if (soldIdx === -1) {
    soldIdx = find(ONHAND_COLUMNS);
    if (soldIdx === -1) {
      throw new Error(
        `No sales column found. Expected "Sold Qty" — this file has ${headers.map((h) => `"${h}"`).join(", ")}. Re-run the Modisoft Inventory export with the Sold Qty column turned on.`
      );
    }
    matchedColumn = `${headers[soldIdx]} (read as a sold counter)`;
    negate = true;
  }

  const byUpc = new Map<string, SalesRow>();
  let totalRows = 0;
  let zeroSales = 0;
  let skipped = 0;

  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    if (!r || r.every((c) => (c ?? "").trim() === "")) continue;
    totalRows++;

    const upcNorm = normalizeUpc(r[codeIdx]);
    if (!upcNorm) {
      skipped++;
      continue;
    }

    let sold = toNumber(r[soldIdx]);
    if (negate) sold = -sold;
    // A sold count is never negative. Returns and adjustments can push it
    // below zero; those are noise, not demand.
    if (!(sold > 0)) {
      zeroSales++;
      continue;
    }

    const name = nameIdx >= 0 ? (r[nameIdx] ?? "").trim() : "";
    // One scan code can appear on several rows (size variants sharing a code).
    // Their sales are the same product's sales, so add them up.
    const prev = byUpc.get(upcNorm);
    if (prev) {
      prev.soldUnits += sold;
      if (!prev.name && name) prev.name = name;
    } else {
      byUpc.set(upcNorm, { upcNorm, soldUnits: sold, name });
    }
  }

  return {
    rows: [...byUpc.values()],
    headers,
    matchedColumn,
    totalRows,
    zeroSales,
    skipped,
  };
}

/** Tolerates "1,234", "$12.50", "(5)" and blanks. */
function toNumber(v: string | undefined): number {
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()$,\s]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}
