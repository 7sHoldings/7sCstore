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
  { href: "/reports", label: "Reports", icon: "assessment", perm: "viewProfit", mobile: true },
  { href: "/users", label: "Users", icon: "group", perm: "manageUsers" },
];
