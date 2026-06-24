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

export const EXPENSE_TEMPLATE_HEADERS = [
  "date",
  "category",
  "payee",
  "amount",
  "checkNo",
  "paymentMethod",
  "note",
];

export const EXPENSE_TEMPLATE_CSV =
  EXPENSE_TEMPLATE_HEADERS.join(",") +
  "\n" +
  [
    // category: STORE_OPERATING_EXPENSES or INVENTORY_PURCHASE
    // paymentMethod: CASH, CARD, CHECK or OTHER (defaults to CASH)
    "2026-06-01,STORE_OPERATING_EXPENSES,Electricity,842.17,,OTHER,",
    "2026-06-02,INVENTORY_PURCHASE,Mikes Wholesale,1240.55,1208,CHECK,Inv 5567",
    "2026-06-02,INVENTORY_PURCHASE,Reddy Ice,164.80,,CASH,",
  ].join("\n") +
  "\n";

export const DAILY_SALES_TEMPLATE_HEADERS = [
  "date",
  "dailySales",
  "fuel",
  "lotto",
  "lottery",
  "lotteryPayout",
  "total",
  "credit",
  "cash",
  "shortOver",
];

export const DAILY_SALES_TEMPLATE_CSV =
  DAILY_SALES_TEMPLATE_HEADERS.join(",") +
  "\n" +
  [
    // One row per day. dailySales=Inside Sales, total=Z-Tape (register grand total).
    "2026-05-06,3878.76,2256.28,74.50,704.00,451.00,6767.59,4096.70,2482.00,2.25",
  ].join("\n") +
  "\n";

export const RECON_TEMPLATE_HEADERS = [
  "date",
  "lotterySales",
  "lotteryPayout",
  "ebt",
  "otherCredit",
  "payoutCash",
  "houseAccount",
];

export const RECON_TEMPLATE_CSV =
  RECON_TEMPLATE_HEADERS.join(",") +
  "\n" +
  [
    // Employee manual lottery + credit entries that drive the day's Short/Over.
    "2026-05-06,778.50,451.00,0,0,120.14,73.00",
  ].join("\n") +
  "\n";

export const HOUSE_TEMPLATE_HEADERS = ["date", "account", "charge", "payback"];

export const HOUSE_TEMPLATE_CSV =
  HOUSE_TEMPLATE_HEADERS.join(",") +
  "\n" +
  [
    // charge = money charged to the account that day; payback = money the
    // customer paid back. One row per account per day with activity.
    "2026-01-06,Texas Bank,46.00,0",
    "2026-01-21,Texas Bank,0,921.92",
    "2026-01-23,First Baptist Church,30.00,0",
  ].join("\n") +
  "\n";
