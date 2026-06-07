import type { Permission } from "./rbac";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Permission required to see this item (omitted = always visible). */
  perm?: Permission;
  /** Show in the mobile bottom bar. */
  mobile?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", mobile: true },
  { href: "/sales", label: "Sales", icon: "payments", perm: "enterSales", mobile: true },
  { href: "/expenses", label: "Expenses", icon: "receipt_long", perm: "enterExpenses" },
  { href: "/purchases", label: "Purchases", icon: "local_shipping", perm: "enterPurchases" },
  { href: "/vendors", label: "Vendors", icon: "store", perm: "enterPurchases" },
  { href: "/inventory", label: "Inventory", icon: "inventory_2", perm: "viewAll" },
  { href: "/shifts", label: "Shifts", icon: "schedule", perm: "enterSales" },
  { href: "/payroll", label: "Payroll", icon: "badge", perm: "viewAll" },
  { href: "/bank", label: "Banking", icon: "account_balance", perm: "viewAll" },
  { href: "/import", label: "Import", icon: "upload_file", perm: "enterSales" },
  { href: "/reports", label: "Reports", icon: "assessment", perm: "viewProfit", mobile: true },
  { href: "/insights", label: "AI Insights", icon: "auto_awesome", perm: "viewProfit" },
  { href: "/integrations", label: "Integrations", icon: "sync", perm: "viewAll" },
  { href: "/locations", label: "Locations", icon: "location_on", perm: "manageUsers" },
  { href: "/users", label: "Users", icon: "group", perm: "manageUsers" },
];
