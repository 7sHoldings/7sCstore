/**
 * Role-based access control — encodes the permission matrix in SRS §4.11.
 *
 *  Action            Owner  Manager  Accountant  Employee
 *  viewAll            ✅     ◑        ◑           ❌
 *  enterSales         ✅     ✅       ❌          ◑ (limited)
 *  enterExpenses      ✅     ✅       ❌          ❌
 *  enterPurchases     ✅     ✅       ❌          ❌
 *  editDelete         ✅     ◑        ❌          ❌
 *  viewProfit         ✅     ◑        ✅          ❌
 *  exportReports      ✅     ◑        ✅          ❌
 *  manageUsers        ✅     ❌       ❌          ❌
 */

export type Role = "OWNER" | "MANAGER" | "ACCOUNTANT" | "EMPLOYEE";

export type Permission =
  | "viewAll"
  | "enterSales"
  | "enterExpenses"
  | "enterPurchases"
  | "editDelete"
  | "viewProfit"
  | "exportReports"
  | "manageUsers";

const MATRIX: Record<Role, Permission[]> = {
  OWNER: [
    "viewAll",
    "enterSales",
    "enterExpenses",
    "enterPurchases",
    "editDelete",
    "viewProfit",
    "exportReports",
    "manageUsers",
  ],
  MANAGER: [
    "viewAll",
    "enterSales",
    "enterExpenses",
    "enterPurchases",
    "editDelete",
    "viewProfit",
    "exportReports",
  ],
  ACCOUNTANT: ["viewProfit", "exportReports"],
  EMPLOYEE: ["enterSales"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner / Admin",
  MANAGER: "Manager",
  ACCOUNTANT: "Accountant",
  EMPLOYEE: "Employee",
};
