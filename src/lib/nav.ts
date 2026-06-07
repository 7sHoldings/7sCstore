import type { Permission } from "./rbac";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Permission required to see this item (omitted = always visible). */
  perm?: Permission;
  /** Show in the mobile bottom bar. */
  mobile?: boolean;
  /** Sidebar grouping. */
  section?: "main" | "manage";
}

export const NAV_ITEMS: NavItem[] = [
  // Primary — reporting / overview
  { href: "/daily", label: "Daily Sales", icon: "event_note", perm: "viewProfit", section: "main", mobile: true },
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", section: "main", mobile: true },
  { href: "/reports", label: "Reports", icon: "assessment", perm: "viewProfit", section: "main", mobile: true },
  { href: "/insights", label: "AI Insights", icon: "auto_awesome", perm: "viewProfit", section: "main" },
  { href: "/integrations", label: "Integrations", icon: "sync", perm: "viewAll", section: "main" },

  // Manage — data entry / admin
  { href: "/sales", label: "Sales", icon: "payments", perm: "enterSales", section: "manage" },
  { href: "/expenses", label: "Expenses", icon: "receipt_long", perm: "enterExpenses", section: "manage" },
  { href: "/purchases", label: "Purchases", icon: "local_shipping", perm: "enterPurchases", section: "manage" },
  { href: "/vendors", label: "Vendors", icon: "store", perm: "enterPurchases", section: "manage" },
  { href: "/inventory", label: "Inventory", icon: "inventory_2", perm: "viewAll", section: "manage" },
  { href: "/shifts", label: "Shifts", icon: "schedule", perm: "enterSales", section: "manage" },
  { href: "/payroll", label: "Payroll", icon: "badge", perm: "viewAll", section: "manage" },
  { href: "/bank", label: "Banking", icon: "account_balance", perm: "viewAll", section: "manage" },
  { href: "/import", label: "Import", icon: "upload_file", perm: "enterSales", section: "manage" },
  { href: "/locations", label: "Locations", icon: "location_on", perm: "manageUsers", section: "manage" },
  { href: "/users", label: "Users", icon: "group", perm: "manageUsers", section: "manage" },
];
