/**
 * Parser for a GSC (Grocery Supply Company) printable order PDF, as downloaded
 * from the ziizii ordering portal.
 *
 * Layout notes that drive the approach:
 *  - A record starts with `<SKU> <14-digit UPC>` and ends on the line carrying
 *    the `true|false` "Get Labels?" flag. Everything between is description
 *    text, which wraps across a variable number of lines.
 *  - So records are accumulated line-by-line, then parsed from the RIGHT: the
 *    three dollar amounts and flags first, then the pack, leaving the
 *    description. Parsing left-to-right is unsafe because descriptions contain
 *    digits and slashes ("ZIG ZAG 1 1/4", "LDS DUCT TAPE 1 1 2 IN") that a
 *    greedy pattern happily mistakes for the quantity/pack columns.
 *  - "Unit Cost" is the cost of a CASE, not of a sellable unit. Unit cost is
 *    `caseCost / unitsPerCase` — a 6x–24x error if taken at face value.
 */

export interface GscOrderLine {
  /** GSC's own item number. */
  sku: string;
  /** UPC exactly as printed (14-digit GTIN, usually zero-padded). */
  upc: string;
  description: string;
  /** Cases ordered — not used for pricing, kept for reference. */
  quantity: number;
  /** Sellable units in one case (the first number of the "Unit" column). */
  unitsPerCase: number;
  /** The size label after the slash, e.g. "12 PK", "4 OZ", "EACH". */
  sizeLabel: string;
  /** Cost of one case. */
  caseCost: number;
  /** quantity x caseCost, as printed — used to validate the parse. */
  lineCost: number;
  /** GSC's suggested retail, per sellable unit. 0 when not given. */
  srp: number;
}

export interface GscOrder {
  orderId: string;
  customer: string | null;
  /** Line count as stated in the document header, for validation. */
  statedLineCount: number | null;
  /** Approx. cost as stated in the document header, for validation. */
  statedApproxCost: number | null;
  lines: GscOrderLine[];
  warnings: string[];
}

/** Trailing money + flags: `$case $line $srp [RCL] true|false` at end of record. */
const TAIL = /\$\s*([\d,]+\.?\d*)\s+\$\s*([\d,]+\.?\d*)\s+\$\s*([\d,]+\.?\d*)(?:\s+([A-Za-z]))?\s+(true|false)\s*$/;
/** A record begins with the SKU + a 14-digit GTIN. */
const RECORD_START = /^(\d{5,7})\s+(\d{14})\b/;
/** Noise: page footers, print headers, repeated column headings. */
const NOISE = [
  /^https?:\/\//i,
  /Printable Order Guide/i,
  /^SKU\s+UPC\s+Description/i,
  /^\d+\/\d+$/,
];

const num = (s: string | undefined): number => {
  if (!s) return 0;
  const n = Number(String(s).replace(/[$,\s]/g, ""));
  return isFinite(n) ? n : 0;
};

/** Parse the extracted text of a GSC order PDF. */
export function parseGscOrderText(text: string): GscOrder {
  const raw = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  const lines = raw.filter((l) => l && !NOISE.some((re) => re.test(l)));
  const warnings: string[] = [];

  const find = (re: RegExp): string | null => {
    for (const l of lines) {
      const m = l.match(re);
      if (m) return m[1];
    }
    return null;
  };

  const orderId = find(/Order\s*ID\s*[:#]?\s*(\d+)/i);
  const customer = find(/Customer\s+(.+?)\s*$/i);
  const statedLineCountRaw = find(/Line\s*count\s*[:#]?\s*(\d+)/i);
  const statedCostRaw = find(/Approx\.?\s*cost\s*\$?\s*([\d,]+\.?\d*)/i);

  if (!orderId) {
    throw new Error("Could not find an Order ID — is this a GSC printable order PDF?");
  }

  const out: GscOrderLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = lines[i].match(RECORD_START);
    if (!start) {
      i++;
      continue;
    }

    // Accumulate until the record's trailing flag line.
    const parts: string[] = [lines[i]];
    let j = i;
    while (j < lines.length && !TAIL.test(lines[j])) {
      j++;
      if (j < lines.length) {
        // A new record starting before a tail means the previous one is broken.
        if (j > i && RECORD_START.test(lines[j]) && !TAIL.test(lines[j])) break;
        parts.push(lines[j]);
      }
    }

    const joined = parts.join(" ").replace(/\s+/g, " ").trim();
    const parsed = parseRecord(joined);
    if (parsed) out.push(parsed);
    else warnings.push(`Could not read line for SKU ${start[1]}.`);

    i = Math.max(j + 1, i + 1);
  }

  const statedLineCount = statedLineCountRaw ? Number(statedLineCountRaw) : null;
  if (statedLineCount && out.length !== statedLineCount) {
    warnings.push(
      `The document states ${statedLineCount} lines but ${out.length} were read.`
    );
  }

  return {
    orderId,
    customer: customer ?? null,
    statedLineCount,
    statedApproxCost: statedCostRaw ? num(statedCostRaw) : null,
    lines: out,
    warnings,
  };
}

/** Parse one joined record, working right-to-left. */
function parseRecord(joined: string): GscOrderLine | null {
  const head = joined.match(RECORD_START);
  if (!head) return null;
  const [, sku, upc] = head;

  const tail = joined.match(TAIL);
  if (!tail) return null;

  const caseCost = num(tail[1]);
  const lineCost = num(tail[2]);
  const srp = num(tail[3]);

  // Between the SKU/UPC and the money sits: <description> <qty> <units> / <size>
  const middle = joined.slice(head[0].length, joined.length - tail[0].length).trim();
  const tokens = middle.split(" ").filter(Boolean);

  // The pack separator is a standalone "/" — descriptions embed slashes without
  // spaces ("1 1/4"), so only a lone slash token can be the real separator, and
  // the LAST one is the pack because the pack is always the final column here.
  let slash = -1;
  for (let k = tokens.length - 1; k >= 0; k--) {
    if (tokens[k] === "/") {
      slash = k;
      break;
    }
  }
  if (slash < 2) return null; // need at least <qty> <units> before it

  const unitsPerCase = Number(tokens[slash - 1]);
  const quantity = Number(tokens[slash - 2]);
  if (!isFinite(unitsPerCase) || unitsPerCase <= 0) return null;
  if (!isFinite(quantity)) return null;

  const sizeLabel = tokens.slice(slash + 1).join(" ").trim();
  const description = tokens.slice(0, slash - 2).join(" ").trim();

  return {
    sku,
    upc,
    description,
    quantity,
    unitsPerCase,
    sizeLabel,
    caseCost,
    lineCost,
    srp,
  };
}

/** Cost of one sellable unit — the figure retail pricing is built from. */
export function unitCost(line: GscOrderLine): number {
  const n = line.unitsPerCase > 0 ? line.unitsPerCase : 1;
  return Math.round((line.caseCost / n + Number.EPSILON) * 10000) / 10000;
}

/**
 * Normalize a scan code for matching. GSC prints 14-digit GTINs
 * (`00037000004714`) while the POS stores 12-digit UPC-A (`037000004714`);
 * stripping leading zeros makes both sides comparable.
 */
export function normalizeUpc(code: string | null | undefined): string {
  const digits = String(code ?? "").replace(/\D/g, "");
  return digits.replace(/^0+/, "");
}
