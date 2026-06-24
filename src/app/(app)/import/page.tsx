import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import ImportForm from "./ImportForm";
import { importSales, importExpenses, importDailySales, importDailyReconciliation, importHouseAccounts } from "./actions";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = (await getSession())!;
  const canSales = can(session.role, "enterSales");
  const canExpenses = can(session.role, "enterExpenses");
  if (!canSales && !canExpenses) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Your role can't import data." /></Card>;
  }

  return (
    <div>
      <PageHeader
        title="Import Data"
        subtitle="Bulk-import sales or expenses from a CSV / Excel export — the manual side of the integration layer"
      />
      <div className="max-w-2xl space-y-6">
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
