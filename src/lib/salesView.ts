/**
 * Shared sales-view model used by both the Daily Sales page and the Dashboard so
 * they stay consistent. Splits a set of sales into three buckets — Merchandise
 * (excludes fuel + lottery), Lottery/Lotto, and Fuel — each with a cash /
 * credit-debit / total breakdown, plus department and fuel-grade groupings.
 */
import { money } from "./calc";

export type SaleRow = {
  paymentType: string;
  amount: number;
  refund: number;
  category: string;
  note: string | null;
};
export type FuelRow = { grade: string; gallons: number; total: number; pricePerGallon: number };

export interface Split {
  cash: number;
  card: number;
  total: number;
}
export interface Dept {
  name: string;
  sales: number;
  refund: number;
}
export interface FuelGrade {
  grade: string;
  gallons: number;
  total: number;
  price: number;
}

export interface SalesView {
  merch: { split: Split; depts: Dept[]; refund: number; taxable: number };
  lotto: { split: Split; depts: Dept[] };
  fuel: { split: Split; byGrade: FuelGrade[]; gallons: number };
  total: Split;
}

/** Departments that aren't subject to sales tax (e.g. "NON TAX", EBT/food stamp). */
export function isNonTaxableDept(name: string): boolean {
  return /non[\s-]?tax|ebt|food\s?stamp/i.test(name);
}

export function deptName(note: string | null, category: string): string {
  if (note && note.startsWith("Modisoft ")) return note.slice(9) || category;
  return note || category;
}

/** Cash / credit-debit / total for a set of rows (non-cash treated as card). */
export function split(rows: { paymentType: string; amount: number }[]): Split {
  let cash = 0;
  let card = 0;
  for (const r of rows) {
    if (r.paymentType === "CASH") cash += r.amount;
    else card += r.amount;
  }
  return { cash: money(cash), card: money(card), total: money(cash + card) };
}

/** Group rows by department name → { sales, refund }, sorted by sales desc. */
export function byDept(rows: SaleRow[]): Dept[] {
  const m = new Map<string, { sales: number; refund: number }>();
  for (const r of rows) {
    const name = deptName(r.note, r.category);
    const d = m.get(name) ?? { sales: 0, refund: 0 };
    d.sales += r.amount;
    d.refund += r.refund;
    m.set(name, d);
  }
  return [...m.entries()]
    .map(([name, v]) => ({ name, sales: money(v.sales), refund: money(v.refund) }))
    .sort((a, b) => b.sales - a.sales);
}

/**
 * Group fuel rows into grades, folding **Mid-grade** into Regular + Premium
 * (mid is blended 50/50 from the regular and premium tanks), so only Regular,
 * Premium and Diesel are reported. Price is the blended $/gal.
 */
export function gradesFromFuel(fuelSales: FuelRow[]): FuelGrade[] {
  const m = new Map<string, { gallons: number; total: number }>();
  for (const f of fuelSales) {
    const e = m.get(f.grade) ?? { gallons: 0, total: 0 };
    e.gallons += f.gallons;
    e.total += f.total;
    m.set(f.grade, e);
  }
  const mid = m.get("MID");
  if (mid) {
    m.delete("MID");
    for (const k of ["REGULAR", "PREMIUM"]) {
      const e = m.get(k) ?? { gallons: 0, total: 0 };
      e.gallons += mid.gallons / 2;
      e.total += mid.total / 2;
      m.set(k, e);
    }
  }
  const order = ["REGULAR", "PREMIUM", "DIESEL"];
  const rank = (g: string) => { const i = order.indexOf(g); return i < 0 ? 99 : i; };
  return [...m.entries()]
    .map(([grade, v]) => ({ grade, gallons: money(v.gallons), total: money(v.total), price: v.gallons ? v.total / v.gallons : 0 }))
    .sort((a, b) => rank(a.grade) - rank(b.grade) || b.total - a.total);
}

export function buildSalesView(sales: SaleRow[], fuelSales: FuelRow[]): SalesView {
  const merchRows = sales.filter((s) => s.category !== "FUEL" && s.category !== "LOTTERY");
  const lottoRows = sales.filter((s) => s.category === "LOTTERY");
  const fuelRows = sales.filter((s) => s.category === "FUEL");

  const merchDepts = byDept(merchRows);
  const lottoDepts = byDept(lottoRows);

  const byGrade = gradesFromFuel(fuelSales);

  const taxable = money(
    merchRows.reduce((s, r) => (isNonTaxableDept(deptName(r.note, r.category)) ? s : s + r.amount), 0)
  );

  return {
    merch: { split: split(merchRows), depts: merchDepts, refund: money(merchDepts.reduce((s, d) => s + d.refund, 0)), taxable },
    lotto: { split: split(lottoRows), depts: lottoDepts },
    fuel: { split: split(fuelRows), byGrade, gallons: money(fuelSales.reduce((s, x) => s + x.gallons, 0)) },
    total: split(sales),
  };
}
