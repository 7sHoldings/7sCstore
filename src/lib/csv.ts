/** Minimal RFC-4180-ish CSV parser (handles quoted fields and commas). */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignore; \n handles line end
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export const SALES_TEMPLATE_HEADERS = [
  "date",
  "category",
  "paymentType",
  "amount",
  "taxCollected",
  "grade",
  "gallons",
  "pricePerGallon",
  "note",
];

export const SALES_TEMPLATE_CSV =
  SALES_TEMPLATE_HEADERS.join(",") +
  "\n" +
  [
    "2026-06-01,FUEL,CARD,,,REGULAR,12.5,3.199,Pump 2",
    "2026-06-01,STORE,CASH,124.50,8.71,,,,Snacks",
    "2026-06-01,LOTTERY,CASH,32.00,,,,,Commission only",
  ].join("\n") +
  "\n";
