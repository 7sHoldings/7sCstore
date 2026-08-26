import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import ImportForm from "./ImportForm";
import { importSales, importExpenses, importDailySales, importDailyReconciliation, importHouseAccounts, importMoneyIncoming, importMonthlySummary, importWholesaleCosts, importInventoryPrices } from "./actions";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = (await getSession())!;
  const canSales = can(session.role, "enterSales");
  const canExpenses = can(session.role, "enterExpenses");
  const canProfit = can(session.role, "viewProfit");
  const canPurchases = can(session.role, "enterPurchases");
  if (!canSales && !canExpenses && !canProfit && !canPurchases) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Your role can't import data." /></Card>;
  }

  return (
    <div>
      <PageHeader
        title="Import Data"
        subtitle="Bulk-import sales or expenses from a CSV / Excel export — the manual side of the integration layer"
      />
      <div className="max-w-2xl space-y-6">
        {canPurchases && (
          <ImportForm
            action={importInventoryPrices}
            accept=".csv,text/csv,.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            title="Import Price Updates (CSV)"
            description="Bulk-update retail prices and push them to the POS. Edit the newRetail column of an Inventory → Export CSV (or use the template), then upload here. Matches by posItemId or upc. Columns: posItemId, upc, newRetail."
            templateHref="/api/import/template?type=prices"
            entityLabel="prices pushed"
          />
        )}
        {canPurchases && (
          <ImportForm
            action={importWholesaleCosts}
            accept=".csv,text/csv,.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            title="Import Wholesale Costs (CSV)"
            description="Set case cost per product so margins read correctly. Edit the caseCost / unitsPerCase / vendor columns of an Inventory → Export CSV (or a distributor price list), then upload. Matches by posItemId or upc; blank caseCost rows are skipped. Retail is left as-is."
            templateHref="/api/import/template?type=cost"
            entityLabel="costs matched"
          />
        )}
        {canSales && (
          <ImportForm
            action={importDailySales}
            title="Import Daily Sales (CSV)"
            description="One row per day from the Excel daily sheet. Columns: date, dailySales, fuel, lotto, lottery, lotteryPayout, total, credit, cash, shortOver. Shown in Monthly Sales."
            templateHref="/api/import/template?type=daily"
            entityLabel="days"
          />
        )}
        {canSales && (
          <ImportForm
            action={importDailyReconciliation}
            title="Import Daily Reconciliation (CSV)"
            description="Per-day manual lottery + credit entries that make the Daily page's Short/Over reconcile. Columns: date, lotterySales, lotteryPayout, ebt, otherCredit, payoutCash, houseAccount."
            templateHref="/api/import/template?type=recon"
            entityLabel="days"
          />
        )}
        {canSales && (
          <ImportForm
            action={importHouseAccounts}
            title="Import House Accounts (CSV)"
            description="Per-account charges & paybacks (charge = charged, payback = paid). Shows on the House Accounts page and ties to the daily House Account total. Columns: date, account, charge, payback. Run AFTER reconciliation."
            templateHref="/api/import/template?type=house"
            entityLabel="entries"
          />
        )}
        {canSales && (
          <ImportForm
            action={importMoneyIncoming}
            title="Import Money Incoming (CSV)"
            description="Non-sales income. Columns: date, rent, gameMachine, stagityInvestment, beer. Shown in the Money Incoming section."
            templateHref="/api/import/template?type=income"
            entityLabel="entries"
          />
        )}
        {canProfit && (
          <ImportForm
            action={importMonthlySummary}
            title="Import Monthly Summary (CSV)"
            description="The P&L summary by month and year. Columns: year, category, jan..dec, annual. Shown in the Monthly Summary section."
            templateHref="/api/import/template?type=summary"
            entityLabel="rows"
          />
        )}
        {canSales && (
          <ImportForm
            action={importSales}
            title="Import Sales (CSV)"
            description="Columns: date, category, paymentType, amount, taxCollected, grade, gallons, pricePerGallon, note. Fuel rows use grade/gallons/pricePerGallon; other rows use amount."
            templateHref="/api/import/template"
            entityLabel="sales"
          />
        )}
        {canExpenses && (
          <ImportForm
            action={importExpenses}
            title="Import Expenses (CSV)"
            description="Columns: date, category, payee, amount, checkNo, paymentMethod, note. category is STORE_OPERATING_EXPENSES or INVENTORY_PURCHASE; payee is the expense type or vendor."
            templateHref="/api/import/template?type=expenses"
            entityLabel="expenses"
          />
        )}
      </div>
    </div>
  );
}
