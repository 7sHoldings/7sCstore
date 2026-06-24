import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { dateWhere } from "@/lib/filters";
import { fmtMoney, fmtDate, expenseCatLabel, paymentLabel } from "@/lib/format";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import Filters from "@/components/Filters";
import ExpenseForm from "./ExpenseForm";
import QuickExpenseRow from "./QuickExpenseRow";
import DeleteButton from "@/components/DeleteButton";
import { deleteExpense } from "./actions";
import { toISODate } from "@/lib/period";
import { STORE_OPERATING_EXPENSE_TYPES, INVENTORY_VENDORS } from "@/lib/expenseOptions";

export const dynamic = "force-dynamic";

const CATEGORIES = ["STORE_OPERATING_EXPENSES", "INVENTORY_PURCHASE"];

// Base list + custom (DB) additions, case-insensitive de-dupe, base order first.
function mergeOptions(base: readonly string[], custom: string[]): string[] {
  const seen = new Set(base.map((b) => b.toLowerCase()));
  const out = [...base];
  for (const c of custom) {
    if (!seen.has(c.toLowerCase())) {
      seen.add(c.toLowerCase());
      out.push(c);
    }
  }
  return out;
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "enterExpenses") && !can(session.role, "viewAll")) {
    return <NoAccess />;
  }
  const sp = await searchParams;

  const loc = await getActiveLocationId();
  const where: Record<string, unknown> = { ...dateWhere(sp) };
  if (loc) where.locationId = loc;
  if (sp.category) where.category = sp.category;

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { date: "desc" },
    take: 300,
  });

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const recurringTotal = expenses.filter((e) => e.recurring).reduce((s, e) => s + e.amount, 0);

  // Category breakdown
  const byCat = new Map<string, number>();
  for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  const canDelete = can(session.role, "editDelete");
  const canAdd = can(session.role, "enterExpenses");

  // Dropdown options: seeded base lists + any custom options staff have added.
  const customOptions = loc
    ? await prisma.expenseOption.findMany({ where: { locationId: loc }, orderBy: { createdAt: "asc" } })
    : [];
  const operatingTypes = mergeOptions(
    STORE_OPERATING_EXPENSE_TYPES,
    customOptions.filter((o) => o.kind === "EXPENSE_TYPE").map((o) => o.value)
  );
  const vendors = mergeOptions(
    INVENTORY_VENDORS,
    customOptions.filter((o) => o.kind === "VENDOR").map((o) => o.value)
  );

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Operating expenses by category, vendor, and payment method"
        actions={canAdd && <ExpenseForm defaultDate={toISODate(new Date())} operatingTypes={operatingTypes} vendors={vendors} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile label="Total Expenses" value={fmtMoney(total)} />
        <Tile label="Recurring" value={fmtMoney(recurringTotal)} />
        {top.slice(0, 2).map(([c, v]) => (
          <Tile key={c} label={expenseCatLabel(c)} value={fmtMoney(v)} />
        ))}
      </div>

      {canAdd && <QuickExpenseRow defaultDate={toISODate(new Date())} operatingTypes={operatingTypes} vendors={vendors} />}

      <Filters
        selects={[{ name: "category", label: "Category", options: CATEGORIES.map((c) => ({ value: c, label: expenseCatLabel(c) })) }]}
      />

      <Card className="overflow-hidden">
        {expenses.length === 0 ? (
          <EmptyState icon="receipt_long" title="No expenses found" hint="Adjust filters or record a new expense." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Payee</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  {canDelete && <th></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 whitespace-nowrap text-on-surface-variant">{fmtDate(e.date)}</td>
                    <td className="px-4 py-3">
                      <Badge>{expenseCatLabel(e.category)}</Badge>
                      {e.recurring && <span className="ml-1.5 text-tertiary text-[16px] material-symbols-outlined align-middle">autorenew</span>}
                    </td>
                    <td className="px-4 py-3 text-on-surface">{e.payee || "—"}{e.checkNo && <span className="text-on-surface-variant"> · Check #{e.checkNo}</span>}{e.note && <span className="text-on-surface-variant"> · {e.note}</span>}</td>
                    <td className="px-4 py-3">{paymentLabel(e.paymentMethod)}</td>
                    <td className="px-4 py-3 text-right tabular font-semibold text-error">{fmtMoney(e.amount)}</td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <DeleteButton id={e.id} action={deleteExpense} label="Delete this expense?" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
      <div className="tabular text-lg font-bold text-on-surface mt-1">{value}</div>
    </Card>
  );
}

function NoAccess() {
  return (
    <Card className="p-8">
      <EmptyState icon="lock" title="No access" hint="Your role can't view expenses." />
    </Card>
  );
}
