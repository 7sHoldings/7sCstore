import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { getPayoutTotals } from "@/lib/credit";
import { fmtMoney } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  const totals = loc ? await getPayoutTotals(loc) : new Map<string, number>();
  const rows = [...totals.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div>
      <PageHeader title="Payouts in Cash" subtitle="Cash paid out of the register, summed by category (all time)." />

      <Card className="overflow-hidden max-w-2xl">
        <div className="px-5 py-4 border-b border-outline-variant/60 flex items-center justify-between">
          <h3 className="font-semibold text-on-surface">By category</h3>
          <span className="text-body-sm text-on-surface-variant">Total <span className="tabular font-bold text-error">{fmtMoney(total)}</span></span>
        </div>
        {rows.length === 0 ? (
          <div className="p-8"><EmptyState icon="payments" title="No payouts yet" hint="Cash payouts entered on Credit Entry show here." /></div>
        ) : (
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3 text-right">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/40">
              {rows.map((r) => (
                <tr key={r.category} className="hover:bg-surface-container-low/50">
                  <td className="px-5 py-3 font-medium text-on-surface">{r.category}</td>
                  <td className="px-5 py-3 text-right tabular text-error">{fmtMoney(r.amount)}</td>
                  <td className="px-5 py-3 text-right tabular text-on-surface-variant">{total > 0 ? `${((r.amount / total) * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-container font-bold">
                <td className="px-5 py-3">Total</td>
                <td className="px-5 py-3 text-right tabular text-error">{fmtMoney(total)}</td>
                <td className="px-5 py-3 text-right tabular">100.0%</td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
    </div>
  );
}
