import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { getHouseBalances, getHousePayments, getCreditManualRange, getAccountLedger, getHouseChargeEntries } from "@/lib/credit";
import { rangeFor, customRange, type PeriodKey, type Range } from "@/lib/period";
import { signedUrl, signedUrls, isStorageConfigured } from "@/lib/storage";
import { getReceipts } from "@/lib/receipts";
import { fmtMoney } from "@/lib/format";
import { todayISO } from "@/lib/day";
import { Card, PageHeader, EmptyState, Icon, Banner } from "@/components/ui";
import { recordHousePayment, removeHousePayment } from "./actions";
import PeriodBar from "@/components/PeriodBar";
import AccountFilter from "./AccountFilter";
import ReceiptInput from "../credit-entry/ReceiptInput";
import { ReceiptThumbs } from "@/components/ReceiptThumbs";

export const dynamic = "force-dynamic";

export default async function HouseAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string; period?: string; from?: string; to?: string; account?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "enterSales")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;

  const [allBalances, allPayments] = await Promise.all([
    loc ? getHouseBalances(loc) : Promise.resolve([]),
    loc ? getHousePayments(loc) : Promise.resolve([]),
  ]);
  const accountNames = allBalances.map((b) => b.account);
  const selectedAccount = sp.account && accountNames.includes(sp.account) ? sp.account : undefined;
  const balances = selectedAccount ? allBalances.filter((b) => b.account === selectedAccount) : allBalances;
  const totalOutstanding = balances.reduce((s, b) => s + b.balance, 0);

  // Optional activity window for the Charged / Paid columns and the ledger.
  let activeRange: Range | null = null;
  let activityLabel = "all time";
  if (sp.from && sp.to) { activeRange = customRange(sp.from, sp.to); activityLabel = activeRange.label; }
  else if (sp.period) { activeRange = rangeFor(sp.period as PeriodKey); activityLabel = activeRange.label; }
  const inRange = (dateISO: string) => {
    if (!activeRange) return true;
    const d = new Date(dateISO + "T00:00:00");
    return d >= activeRange.start && d < activeRange.end;
  };

  // Dated statement for the selected account. Running balance is computed over the
  // full history (so it's accurate), then we show only entries within the window.
  const ledger = selectedAccount && loc ? await getAccountLedger(loc, selectedAccount) : [];
  let running = 0;
  const ledgerRows = ledger
    .map((e) => { running += e.kind === "charge" ? e.amount : -e.amount; return { ...e, balance: running }; })
    .filter((e) => inRange(e.date))
    .reverse();
  const ledgerPhotos = await Promise.all(ledgerRows.map((e) => (e.photo ? signedUrl(e.photo) : Promise.resolve(null))));
  // Charges come from a day's Credit Entry — surface that day's receipts (downloadable) for invoicing.
  const chargeReceipts = new Map<string, string[]>();
  if (loc) {
    for (const d of [...new Set(ledgerRows.filter((e) => e.kind === "charge").map((e) => e.date))]) {
      const paths = await getReceipts(loc, "credit", d);
      if (paths.length) chargeReceipts.set(d, await signedUrls(paths));
    }
  }

  const chargedMap = new Map<string, number>();
  const paidMap = new Map<string, number>();
  if (activeRange && loc) {
    const cm = await getCreditManualRange(loc, activeRange.start, activeRange.end);
    for (const h of cm?.house ?? []) chargedMap.set(h.account, h.amount);
    for (const p of allPayments) {
      const d = new Date(p.date + "T00:00:00");
      if (d >= activeRange.start && d < activeRange.end) paidMap.set(p.account, (paidMap.get(p.account) || 0) + p.amount);
    }
  } else {
    for (const b of balances) { chargedMap.set(b.account, b.charged); paidMap.set(b.account, b.paid); }
  }

  const payments = allPayments.filter((p) => inRange(p.date));

  // All-accounts activity statement (charges + payments) for the window.
  type Act = { date: string; account: string; kind: "charge" | "payment"; amount: number; note?: string; photo?: string; id?: string };
  let activity: Act[] = [];
  const dateReceiptMap = new Map<string, string[]>();
  let activityPhotos: (string | null)[] = [];
  if (!selectedAccount && loc) {
    const charges = await getHouseChargeEntries(loc, activeRange?.start, activeRange?.end);
    activity = [
      ...charges.map((c) => ({ date: c.date, account: c.account, kind: "charge" as const, amount: c.amount })),
      ...payments.map((p) => ({ date: p.date, account: p.account, kind: "payment" as const, amount: p.amount, note: p.note, photo: p.photo, id: p.id })),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.kind === "charge" ? -1 : 1)).slice(0, 200);
    for (const d of [...new Set(activity.filter((a) => a.kind === "charge").map((a) => a.date))]) {
      const paths = await getReceipts(loc, "credit", d);
      if (paths.length) dateReceiptMap.set(d, await signedUrls(paths));
    }
    activityPhotos = await Promise.all(activity.map((a) => (a.kind === "payment" && a.photo ? signedUrl(a.photo) : Promise.resolve(null))));
  }
  const today = todayISO();

  return (
    <div>
      <PageHeader title="House Accounts" subtitle="Running balances — charges add up, payments bring them down." />
      {sp.paid && <Banner>Payment recorded.</Banner>}

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <PeriodBar
          period={sp.period}
          from={sp.from}
          to={sp.to}
          path="/house-accounts"
          showDay={false}
          presets={[
            { key: "mtd", label: "This Month" },
            { key: "lastmonth", label: "Last Month" },
            { key: "q1", label: "Q1" },
            { key: "q2", label: "Q2" },
            { key: "q3", label: "Q3" },
            { key: "q4", label: "Q4" },
          ]}
        />
        <AccountFilter accounts={accountNames} value={selectedAccount} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card className="p-4">
          <div className="text-label-caps uppercase text-on-surface-variant">Outstanding (now)</div>
          <div className={`tabular text-2xl font-bold mt-1 ${totalOutstanding > 0 ? "text-error" : "text-secondary"}`}>{fmtMoney(totalOutstanding)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-label-caps uppercase text-on-surface-variant">Accounts</div>
          <div className="tabular text-2xl font-bold mt-1">{balances.length}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="px-5 py-4 border-b border-outline-variant/60 flex items-center justify-between">
            <h3 className="font-semibold text-on-surface">Balances</h3>
            <span className="text-body-sm text-on-surface-variant">Activity · {activityLabel}</span>
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
                    <th className="px-5 py-3 text-right">Balance (now)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {balances.map((b) => (
                    <tr key={b.account} className="hover:bg-surface-container-low/50">
                      <td className="px-5 py-3 font-medium text-on-surface">{b.account}</td>
                      <td className="px-5 py-3 text-right tabular">{fmtMoney(chargedMap.get(b.account) || 0)}</td>
                      <td className="px-5 py-3 text-right tabular text-secondary">{fmtMoney(paidMap.get(b.account) || 0)}</td>
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
              <select id="account" name="account" className="ft-input w-full" required defaultValue={selectedAccount ?? ""}>
                <option value="" disabled>— Select account —</option>
                {allBalances.map((b) => <option key={b.account} value={b.account}>{b.account} ({fmtMoney(b.balance)} due)</option>)}
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
            <ReceiptInput configured={isStorageConfigured()} />
            <button type="submit" className="ft-btn-primary w-full justify-center"><Icon name="check" className="text-[18px]" /> Record payment</button>
          </form>
        </Card>
      </div>

      {selectedAccount ? (
        <Card className="overflow-hidden mt-6">
          <div className="px-5 py-4 border-b border-outline-variant/60 flex items-center justify-between">
            <h3 className="font-semibold text-on-surface">{selectedAccount} — history</h3>
            <span className="text-body-sm text-on-surface-variant">Charges &amp; payments, newest first</span>
          </div>
          {ledgerRows.length === 0 ? (
            <div className="p-8"><EmptyState icon="receipt_long" title="No activity yet" /></div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Note</th>
                    <th className="px-5 py-3">Receipt</th>
                    <th className="px-5 py-3 text-right">Charge</th>
                    <th className="px-5 py-3 text-right">Payment</th>
                    <th className="px-5 py-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {ledgerRows.map((e, i) => (
                    <tr key={`${e.date}-${e.kind}-${i}`} className="hover:bg-surface-container-low/50">
                      <td className="px-5 py-3 tabular text-on-surface-variant">{e.date}</td>
                      <td className="px-5 py-3">
                        <span className={`text-label-caps uppercase ${e.kind === "payment" ? "text-secondary" : "text-on-surface-variant"}`}>{e.kind === "payment" ? "Payment" : "Charge"}</span>
                      </td>
                      <td className="px-5 py-3 text-on-surface-variant">{e.note || "—"}</td>
                      <td className="px-5 py-3">
                        <ReceiptThumbs urls={e.kind === "payment" ? (ledgerPhotos[i] ? [ledgerPhotos[i]!] : []) : (chargeReceipts.get(e.date) ?? [])} />
                      </td>
                      <td className="px-5 py-3 text-right tabular">{e.kind === "charge" ? fmtMoney(e.amount) : "—"}</td>
                      <td className="px-5 py-3 text-right tabular text-secondary">{e.kind === "payment" ? fmtMoney(e.amount) : "—"}</td>
                      <td className={`px-5 py-3 text-right tabular font-semibold ${e.balance > 0 ? "text-error" : "text-secondary"}`}>{fmtMoney(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : activity.length > 0 && (
        <Card className="overflow-hidden mt-6">
          <div className="px-5 py-4 border-b border-outline-variant/60 flex items-center justify-between">
            <h3 className="font-semibold text-on-surface">Activity · {activityLabel}</h3>
            <span className="text-body-sm text-on-surface-variant">All accounts — charges &amp; payments</span>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Account</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Note</th>
                  <th className="px-5 py-3">Receipt</th>
                  <th className="px-5 py-3 text-right">Charge</th>
                  <th className="px-5 py-3 text-right">Payment</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {activity.map((a, i) => (
                  <tr key={`${a.date}-${a.kind}-${a.account}-${i}`} className="hover:bg-surface-container-low/50">
                    <td className="px-5 py-3 tabular text-on-surface-variant">{a.date}</td>
                    <td className="px-5 py-3 font-medium text-on-surface">{a.account}</td>
                    <td className="px-5 py-3"><span className={`text-label-caps uppercase ${a.kind === "payment" ? "text-secondary" : "text-on-surface-variant"}`}>{a.kind === "payment" ? "Payment" : "Charge"}</span></td>
                    <td className="px-5 py-3 text-on-surface-variant">{a.note || "—"}</td>
                    <td className="px-5 py-3">
                      <ReceiptThumbs urls={a.kind === "charge" ? (dateReceiptMap.get(a.date) ?? []) : (activityPhotos[i] ? [activityPhotos[i]!] : [])} />
                    </td>
                    <td className="px-5 py-3 text-right tabular">{a.kind === "charge" ? fmtMoney(a.amount) : "—"}</td>
                    <td className="px-5 py-3 text-right tabular text-secondary">{a.kind === "payment" ? fmtMoney(a.amount) : "—"}</td>
                    <td className="px-5 py-3 text-right">
                      {a.kind === "payment" && a.id && (
                        <form action={removeHousePayment}>
                          <input type="hidden" name="id" value={a.id} />
                          <button type="submit" className="ft-btn-ghost p-1.5 rounded-md text-on-surface-variant" aria-label="Remove payment"><Icon name="delete" className="text-[18px]" /></button>
                        </form>
                      )}
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
