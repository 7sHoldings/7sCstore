/** Display formatting helpers — USD currency and gallons (A5, NFR-2). */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usd4 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const num = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const fmtMoney = (v: number) => usd.format(v ?? 0);
export const fmtMoney4 = (v: number) => usd4.format(v ?? 0);
export const fmtGallons = (v: number) =>
  `${num.format(v ?? 0)} gal`;
export const fmtNumber = (v: number) => num.format(v ?? 0);

export function fmtPct(v: number | null): string {
  if (v === null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

export function fmtDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const CATEGORY_LABELS: Record<string, string> = {
  FUEL: "Fuel",
  STORE: "Store / Grocery",
  LOTTERY: "Lottery",
  TOBACCO: "Tobacco",
  FOOD_DRINK: "Food / Drink",
  OTHER: "Other",
};

const EXPENSE_LABELS: Record<string, string> = {
  RENT_MORTGAGE: "Rent / Mortgage",
  PAYROLL: "Payroll",
  UTILITIES: "Utilities",
  INTERNET_PHONE: "Internet / Phone",
  REPAIRS_MAINTENANCE: "Repairs & Maintenance",
  STORE_OPERATING_EXPENSES: "Store Operating Expenses",
  INSURANCE: "Insurance",
  VENDOR_PAYMENT: "Vendor Payment",
  FUEL_PURCHASE: "Fuel Purchase",
  PRODUCT_PURCHASE: "Product Purchase",
  INVENTORY_PURCHASE: "Inventory Purchases",
  BANK_FEES: "Bank Fees",
  CARD_PROCESSING_FEES: "Card Processing Fees",
  OTHER: "Other",
};

const GRADE_LABELS: Record<string, string> = {
  REGULAR: "Regular",
  MID: "Mid-grade",
  PREMIUM: "Premium",
  DIESEL: "Diesel",
};

export const catLabel = (c: string) => CATEGORY_LABELS[c] ?? c;
export const expenseCatLabel = (c: string) => EXPENSE_LABELS[c] ?? c;
export const gradeLabel = (g: string) => GRADE_LABELS[g] ?? g;
export const paymentLabel = (p: string) =>
  ({ CASH: "Cash", CARD: "Card", OTHER: "Other" }[p] ?? p);
