// Curated dropdown option lists that sub-categorize an expense.
//
// Sourced from the legacy "Super C West" workbook so the app mirrors how the
// store has always tracked spend:
//   - Store Operating Expenses  <- other_payout_history expense columns (fixed set)
//   - Inventory Purchases       <- item_purchase_history vendor names (suggestions)
//
// The chosen value is stored in Expense.payee (no schema change), so it shows in
// the expenses table and is filterable. ExpenseForm renders the matching control
// when one of these two categories is selected.

// Fixed list — the operating-expense types carried over from other_payout_history.
export const STORE_OPERATING_EXPENSE_TYPES = [
  "Payroll (Cash)",
  "Payroll (Check)",
  "Payroll Tax",
  "Property Tax",
  "Business Tax",
  "Loan Payment",
  "Repair / Maintenance",
  "Phone / Internet",
  "Property Insurance",
  "Tank Insurance",
  "Security (ADT)",
  "Bank Fee",
  "Water Bill",
  "Electricity",
  "License / Permits",
  "Food",
  "Gas (Travel)",
  "Lawn",
  "Amazon",
  "Miscellaneous (In-house)",
  "Miscellaneous (Store)",
  "Stagity (In-house)",
  "Profit Taken Out",
] as const;

// Suggestion list — canonical vendor names from item_purchase_history (spelling
// variants merged, one-off/noise entries dropped). Rendered as a typeable
// combobox so staff can still enter a vendor that isn't listed yet.
export const INVENTORY_VENDORS = [
  "AF Distro",
  "Ali & Sons",
  "Alladin",
  "Amazon",
  "American Distro",
  "American Wholesale",
  "AS Supplies",
  "BC Wholesale",
  "Best Novelties",
  "Bimbo",
  "Blue Bell",
  "Caps",
  "Choice Cap",
  "CO2 Refill",
  "Coca-Cola",
  "Community Coffee",
  "DC Wholesale",
  "Dollar Tree",
  "Donuts",
  "Dr Pepper",
  "Dubai Chocolates",
  "DXD",
  "Fritolay",
  "Frontline",
  "G & G Beer",
  "GSC",
  "Kroger",
  "Massive Distro",
  "Mega Wireless",
  "Mikes Wholesale",
  "Monster Wholesale",
  "National Tobacco",
  "Nepa",
  "Novelty Master",
  "Parker Gas Company",
  "Pepsi",
  "Propane",
  "R & K",
  "RAF Distro",
  "Rave",
  "Ravi",
  "Reddy Ice",
  "Reva",
  "Rito",
  "RNDC Wine",
  "Sams Club",
  "Smoke and Vape King",
  "Smoke Hub",
  "Southern Glazers Wine",
  "SS Distro",
  "SVK",
  "Swisher",
  "Texas Wholesale",
  "TEXSUN Eyewear",
  "TX Boys",
  "TX Distro",
  "Vapes",
  "Walmart",
  "Yummy Ice",
  "Zig Zag",
] as const;

// Categories that get a fixed <select> of sub-options (closed set).
export function fixedSubOptionsFor(category: string): readonly string[] | null {
  if (category === "STORE_OPERATING_EXPENSES") return STORE_OPERATING_EXPENSE_TYPES;
  return null;
}

// Categories that get a typeable combobox of suggestions (open set).
export function vendorSuggestionsFor(category: string): readonly string[] | null {
  if (category === "INVENTORY_PURCHASE") return INVENTORY_VENDORS;
  return null;
}
