/**
 * Builds structured report documents shared by the on-screen preview, the Excel
 * exporter, and the PDF exporter (FR-33, FR-34, FR-35). One builder = identical
 * numbers across every output format.
 */
import { prisma } from "./db";
import { getReportData } from "./reports";
import { type Range } from "./period";
import {
  fmtMoney,
  fmtMoney4,
  fmtNumber,
  fmtDate,
  catLabel,
  expenseCatLabel,
  gradeLabel,
} from "./format";
import { purchaseMargin, money } from "./calc";
import { buildSalesView } from "./salesView";

export type ReportType =
  | "daily_closing"
  | "daily"
  | "weekly"
  | "monthly_pl"
  | "yearly"
  | "expense"
  | "purchase"
  | "vendor"
  | "inventory"
  | "sales_by_category"
  | "tax";

export const REPORT_META: Record<ReportType, { title: string; icon: string; desc: string }> = {
  daily_closing: { title: "Daily Closing", icon: "event_note", desc: "Fuel, lottery & merchandise with cash/credit" },
  daily: { title: "Daily Business Report", icon: "today", desc: "Sales, expenses, and profit for the day" },
  weekly: { title: "Weekly Sales Report", icon: "date_range", desc: "Sales performance across the week" },
  monthly_pl: { title: "Monthly P&L Statement", icon: "summarize", desc: "Full profit & loss statement" },
  yearly: { title: "Yearly Performance", icon: "calendar_month", desc: "Annual sales and profit overview" },
  expense: { title: "Expense Report", icon: "receipt_long", desc: "Expenses grouped by category" },
  purchase: { title: "Purchase Report", icon: "local_shipping", desc: "Product purchases and margins" },
  vendor: { title: "Vendor Report", icon: "store", desc: "Vendor balances and terms" },
  inventory: { title: "Inventory Cost Report", icon: "inventory_2", desc: "Stock value on hand" },
  sales_by_category: { title: "Sales by Category", icon: "category", desc: "Net sales split by category" },
  tax: { title: "Sales Tax Report", icon: "account_balance", desc: "Sales tax collected (liability)" },
};

export interface ReportSection {
  heading: string;
  columns: string[];
  /** Optional per-column alignment: "left" | "right". */
  align?: ("left" | "right")[];
  rows: (string | number)[][];
}

export interface ReportDoc {
  type: ReportType;
  title: string;
  periodLabel: string;
  generatedAt: string;
  summary: { label: string; value: string }[];
  sections: ReportSection[];
}

export async function buildReport(
  type: ReportType,
  range: Range,
  locationId?: string
): Promise<ReportDoc> {
  const meta = REPORT_META[type];
  const generatedAt = new Date().toLocaleString("en-US");
  const base: Omit<ReportDoc, "summary" | "sections"> = {
    type,
    title: meta.title,
    periodLabel: range.label,
    generatedAt,
  };

  // Daily Closing — the sales-focused view (fuel / lottery / merchandise with
  // cash/credit), matching the Daily Sales screen.
  if (type === "daily_closing") {
    const where = { date: { gte: range.start, lt: range.end }, ...(locationId ? { locationId } : {}) };
    const [sales, fuelSales] = await Promise.all([
      prisma.sale.findMany({ where, select: { paymentType: true, amount: true, refund: true, category: true, note: true } }),
      prisma.fuelSale.findMany({ where, select: { grade: true, gallons: true, total: true, pricePerGallon: true } }),
    ]);
    const view = buildSalesView(sales, fuelSales);
    const pct = (v: number) => (view.merch.split.total !== 0 ? `${((v / view.merch.split.total) * 100).toFixed(1)}%` : "—");
    return {
      ...base,
      summary: [
        { label: "Merchandise", value: fmtMoney(view.merch.split.total) },
        { label: "Lottery / Lotto", value: fmtMoney(view.lotto.split.total) },
        { label: "Fuel", value: fmtMoney(view.fuel.split.total) },
        { label: "Total Sales", value: fmtMoney(view.total.total) },
        { label: "Cash", value: fmtMoney(view.total.cash) },
        { label: "Credit / Debit", value: fmtMoney(view.total.card) },
      ],
      sections: [
        {
          heading: `Fuel Sales — Cash ${fmtMoney(view.fuel.split.cash)} · Credit/Debit ${fmtMoney(view.fuel.split.card)}`,
          columns: ["Grade", "Gallons", "Price/gal", "Sales"],
          align: ["left", "right", "right", "right"],
          rows: [
            ...view.fuel.byGrade.map((g) => [gradeLabel(g.grade), fmtNumber(g.gallons), fmtMoney4(g.price), fmtMoney(g.total)]),
            ["Total", fmtNumber(view.fuel.gallons), "", fmtMoney(view.fuel.split.total)],
          ],
        },
        {
          heading: `Lottery / Lotto — Cash ${fmtMoney(view.lotto.split.cash)} · Credit/Debit ${fmtMoney(view.lotto.split.card)}`,
          columns: ["Department", "Sales"],
          align: ["left", "right"],
          rows: [
            ...view.lotto.depts.map((d) => [d.name, fmtMoney(d.sales)]),
            ["Total", fmtMoney(view.lotto.split.total)],
          ],
        },
        {
          heading: `Merchandise — Cash ${fmtMoney(view.merch.split.cash)} · Credit/Debit ${fmtMoney(view.merch.split.card)}`,
          columns: ["Department", "Sales", "Refund", "Sales %"],
          align: ["left", "right", "right", "right"],
          rows: [
            ...view.merch.depts.map((d) => [d.name, fmtMoney(d.sales), d.refund > 0 ? `-${fmtMoney(d.refund)}` : "—", pct(d.sales)]),
            ["Grand Total", fmtMoney(view.merch.split.total), view.merch.refund > 0 ? `-${fmtMoney(view.merch.refund)}` : "—", "100.0%"],
          ],
        },
      ],
    };
  }

  const data = await getReportData(range, locationId);
  const p = data.pnl;

  // Shared P&L summary used by several reports.
  const pnlSummary = [
    { label: "Gross Sales", value: fmtMoney(p.grossSales) },
    { label: "Refunds / Voids", value: fmtMoney(p.refunds) },
    { label: "Net Sales", value: fmtMoney(p.netSales) },
    { label: "COGS", value: fmtMoney(p.cogs) },
    { label: "Gross Profit", value: fmtMoney(p.grossProfit) },
    { label: "Operating Expenses", value: fmtMoney(p.operatingExpenses) },
    { label: "Net Profit", value: fmtMoney(p.netProfit) },
    { label: "Profit Margin", value: `${p.profitMargin}%` },
    { label: "Sales Tax Collected (liability)", value: fmtMoney(p.salesTaxCollected) },
  ];

  const categorySection: ReportSection = {
    heading: "Net Sales by Category",
    columns: ["Category", "Amount"],
    align: ["left", "right"],
    rows: Object.entries(data.byCategory).map(([k, v]) => [catLabel(k), fmtMoney(v)]),
  };

  const paymentSection: ReportSection = {
    heading: "Payment Split",
    columns: ["Type", "Amount"],
    align: ["left", "right"],
    rows: [
      ["Cash", fmtMoney(data.payment.cash)],
      ["Card", fmtMoney(data.payment.card)],
      ["Other", fmtMoney(data.payment.other)],
    ],
  };

  switch (type) {
    case "daily":
    case "weekly":
    case "monthly_pl":
    case "yearly": {
      return {
        ...base,
        summary: pnlSummary,
        sections: [categorySection, paymentSection],
      };
    }

    case "sales_by_category": {
      return {
        ...base,
        summary: [
          { label: "Net Sales", value: fmtMoney(p.netSales) },
          { label: "Sales count", value: String(data.counts.sales) },
        ],
        sections: [categorySection, paymentSection],
      };
    }

    case "tax": {
      // Sales tax collected, grouped by category. This is a liability owed,
      // tracked separately from revenue (Section 3).
      const sales = await prisma.sale.findMany({
        where: {
          date: { gte: range.start, lt: range.end },
          ...(locationId ? { locationId } : {}),
        },
        select: { category: true, taxCollected: true },
      });
      const byCat = new Map<string, number>();
      let totalTax = 0;
      for (const s of sales) {
        byCat.set(s.category, (byCat.get(s.category) ?? 0) + s.taxCollected);
        totalTax += s.taxCollected;
      }
      return {
        ...base,
        summary: [
          { label: "Total Sales Tax Collected", value: fmtMoney(totalTax) },
          { label: "Status", value: "Liability — remit to authority" },
        ],
        sections: [
          {
            heading: "Sales Tax by Category",
            columns: ["Category", "Tax Collected"],
            align: ["left", "right"],
            rows: [...byCat.entries()]
              .filter(([, v]) => v > 0)
              .map(([k, v]) => [catLabel(k), fmtMoney(v)]),
          },
        ],
      };
    }

    case "expense": {
      return {
        ...base,
        summary: [
          { label: "Total Expenses", value: fmtMoney(p.operatingExpenses) },
          { label: "Entries", value: String(data.counts.expenses) },
        ],
        sections: [
          {
            heading: "Expenses by Category",
            columns: ["Category", "Amount"],
            align: ["left", "right"],
            rows: data.expensesByCategory.map((e) => [expenseCatLabel(e.category), fmtMoney(e.amount)]),
          },
        ],
      };
    }

    case "purchase": {
      return {
        ...base,
        summary: [
          { label: "Purchases", value: String(data.counts.purchases) },
          {
            label: "Total Cost",
            value: fmtMoney(data.purchaseLines.reduce((s, l) => s + l.total, 0)),
          },
        ],
        sections: [
          {
            heading: "Purchases",
            columns: ["Date", "Product", "Qty", "Cost ea.", "Total", "Margin %"],
            align: ["left", "left", "right", "right", "right", "right"],
            rows: data.purchaseLines.map((l) => [
              fmtDate(l.date),
              l.productName,
              fmtNumber(l.qty),
              fmtMoney(l.costEach),
              fmtMoney(l.total),
              `${l.margin}%`,
            ]),
          },
        ],
      };
    }

    case "vendor": {
      const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });
      return {
        ...base,
        summary: [
          { label: "Vendors", value: String(vendors.length) },
          { label: "Total Owed", value: fmtMoney(vendors.reduce((s, v) => s + v.balanceOwed, 0)) },
        ],
        sections: [
          {
            heading: "Vendor Balances",
            columns: ["Vendor", "Terms", "Contact", "Balance Owed"],
            align: ["left", "left", "left", "right"],
            rows: vendors.map((v) => [v.name, v.terms ?? "—", v.contact ?? "—", fmtMoney(v.balanceOwed)]),
          },
        ],
      };
    }

    case "inventory": {
      const products = await prisma.product.findMany({
        where: locationId ? { locationId } : {},
        orderBy: { name: "asc" },
      });
      const value = money(products.reduce((s, pr) => s + pr.qtyOnHand * pr.currentCost, 0));
      const fuel = await prisma.fuelInventory.findMany({
        where: locationId ? { locationId } : {},
        orderBy: { date: "desc" },
        take: 20,
      });
      const latest = new Map<string, (typeof fuel)[number]>();
      for (const r of fuel) if (!latest.has(r.grade)) latest.set(r.grade, r);

      return {
        ...base,
        summary: [
          { label: "Inventory Value", value: fmtMoney(value) },
          { label: "Products", value: String(products.length) },
        ],
        sections: [
          {
            heading: "Store Inventory",
            columns: ["Product", "On Hand", "Unit Cost", "Value"],
            align: ["left", "right", "right", "right"],
            rows: products.map((pr) => [
              pr.name,
              fmtNumber(pr.qtyOnHand),
              fmtMoney(pr.currentCost),
              fmtMoney(pr.qtyOnHand * pr.currentCost),
            ]),
          },
          {
            heading: "Fuel Tank Reconciliation",
            columns: ["Grade", "Book", "Physical", "Variance"],
            align: ["left", "right", "right", "right"],
            rows: [...latest.values()].map((r) => [
              gradeLabel(r.grade),
              fmtNumber(r.gallonsBook),
              fmtNumber(r.gallonsPhysical),
              fmtNumber(r.variance),
            ]),
          },
        ],
      };
    }
  }
}

// Helper for report fuel-margin lines (used in some preview contexts).
export { fmtMoney4 };
