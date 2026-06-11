import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { getHouseBalances, getHousePayments } from "@/lib/credit";
import { fmtMoney } from "@/lib/format";
import { Card, PageHeader, EmptyState, Icon, Banner } from "@/components/ui";
import { recordHousePayment, removeHousePayment } from "./actions";

export const dynamic = "force-dynamic";

export default async function HouseAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "enterSales")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;
  const [balances, payments] = await Promise.all([
    loc ? getHouseBalances(loc) : Promise.resolve([]),
    loc ? getHousePayments(loc) : Promise.resolve([]),
  ]);
  const totalOutstanding = balances.reduce((s, b) => s + b.balance, 0);
  const recent = [...payments].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 25);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader title="House Accounts" subtitle="Running balances — charges add up, payments bring them down." />
      {sp.paid && <Banner>Payment recorded.</Banner>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card className="p-4">
          <div className="text-label-caps uppercase text-on-surface-variant">Outstanding (all)</div>
          <div className={`tabular text-2xl font-bold mt-1 ${totalOutstanding > 0 ? "text-error" : "text-secondary"}`}>{fmtMoney(totalOutstanding)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-label-caps uppercase text-on-surface-variant">Accounts</div>
          <div className="tabular text-2xl font-bold mt-1">{balances.length}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="px-5 py-4 border-b border-outline-variant/60">
            <h3 className="font-semibold text-on-surface">Balances</h3>
          </div>
          {balances.length === 0 ? (
            <div className="p-8"><EmptyState icon="account_balance" title="No house accounts yet" hint="Add charges from Credit Entry." /></div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                    <th className="px-5 py-3">Account</th>
                    <th className="px-5 py-3 text-right">Charged</th>
                    <th className="px-5 py-3 text-right">Paid</th>
                    <th className="px-5 py-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {balances.map((b) => (
                    <tr key={b.account} className="hover:bg-surface-container-low/50">
                      <td className="px-5 py-3 font-medium text-on-surface">{b.account}</td>
                      <td className="px-5 py-3 text-right tabular">{fmtMoney(b.charged)}</td>
                      <td className="px-5 py-3 text-right tabular text-secondary">{fmtMoney(b.paid)}</td>
                      <td className={`px-5 py-3 text-right tabular font-bold ${b.balance > 0 ? "text-error" : "text-secondary"}`}>{fmtMoney(b.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-container font-bold">
                    <td className="px-5 py-3">Total outstanding</td>
                    <td className="px-5 py-3"></td>
                    <td className="px-5 py-3"></td>
                    <td className={`px-5 py-3 text-right tabular ${totalOutstanding > 0 ? "text-error" : "text-secondary"}`}>{fmtMoney(totalOutstanding)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-5 h-fit">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="payments" className="text-primary text-[20px]" />
            <h3 className="font-semibold text-on-surface">Record a payment</h3>
          </div>
          <form action={recordHousePayment} className="space-y-3">
            <div>
              <label className="ft-label" htmlFor="account">Account</label>
              <select id="account" name="account" className="ft-input w-full" required defaultValue="">
                <option value="" disabled>— Select account —</option>
                {balances.map((b) => <option key={b.account} value={b.account}>{b.account} ({fmtMoney(b.balance)} due)</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="ft-label" htmlFor="amount">Amount ($)</label>
                <input id="amount" name="amount" type="number" step="0.01" min="0" className="ft-input w-full" placeholder="0.00" required />
              </div>
              <div>
                <label className="ft-label" htmlFor="date">Date</label>
                <input id="date" name="date" type="date" defaultValue={today} className="ft-input w-full" />
              </div>
            </div>
            <div>
              <label className="ft-label" htmlFor="note">Note (optional)</label>
              <input id="note" name="note" className="ft-input w-full" placeholder="e.g. cash, check #123" />
            </div>
            <button type="submit" className="ft-btn-primary w-full justify-center"><Icon name="check" className="text-[18px]" /> Record payment</button>
          </form>
        </Card>
      </div>

      {recent.length > 0 && (
        <Card className="overflow-hidden mt-6">
          <div className="px-5 py-4 border-b border-outline-variant/60">
            <h3 className="font-semibold text-on-surface">Recent payments</h3>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Account</th>
                  <th className="px-5 py-3">Note</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {recent.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-container-low/50">
                    <td className="px-5 py-3 tabular text-on-surface-variant">{p.date}</td>
                    <td className="px-5 py-3 font-medium text-on-surface">{p.account}</td>
                    <td className="px-5 py-3 text-on-surface-variant">{p.note || "—"}</td>
                    <td className="px-5 py-3 text-right tabular text-secondary">{fmtMoney(p.amount)}</td>
                    <td className="px-5 py-3 text-right">
                      <form action={removeHousePayment}>
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className="ft-btn-ghost p-1.5 rounded-md text-on-surface-variant" aria-label="Remove payment"><Icon name="delete" className="text-[18px]" /></button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
