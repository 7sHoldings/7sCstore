import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { getPayoutTotals, getCreditManualRange, getDatedPayouts } from "@/lib/credit";
import { getReceipts } from "@/lib/receipts";
import { signedUrls } from "@/lib/storage";
import { rangeFor, customRange, type PeriodKey, type Range } from "@/lib/period";
import { fmtMoney } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import PeriodBar from "@/components/PeriodBar";
import { ReceiptThumbs } from "@/components/ReceiptThumbs";

export const dynamic = "force-dynamic";

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;

  // Default = all time; a preset or custom range narrows it.
  let activeRange: Range | null = null;
  if (loc && sp.from && sp.to) activeRange = customRange(sp.from, sp.to);
  else if (loc && sp.period) activeRange = rangeFor(sp.period as PeriodKey);

  let rows: { category: string; amount: number }[];
  let label = "all time";
  if (loc && activeRange) {
    rows = ((await getCreditManualRange(loc, activeRange.start, activeRange.end))?.payouts ?? []).map((p) => ({ category: p.account, amount: p.amount }));
    label = activeRange.label;
  } else {
    const totals = loc ? await getPayoutTotals(loc) : new Map<string, number>();
    rows = [...totals.entries()].map(([category, amount]) => ({ category, amount }));
  }
  rows.sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  // Dated entries + downloadable receipts (receipts attach to the day's Credit Entry).
  const dated = loc ? await getDatedPayouts(loc, activeRange?.start, activeRange?.end) : [];
  const datedReceipts = await Promise.all(dated.map((d) => (loc ? getReceipts(loc, "credit", d.date).then((p) => signedUrls(p)) : Promise.resolve([]))));

  return (
    <div>
      <PageHeader title="Payouts in Cash" subtitle={`Cash paid out of the register, summed by category · ${label}`} />

      <div className="mb-6"><PeriodBar period={sp.period} from={sp.from} to={sp.to} path="/payouts" /></div>

      <Card className="overflow-hidden max-w-2xl">
        <div className="px-5 py-4 border-b border-outline-variant/60 flex items-center justify-between">
          <h3 className="font-semibold text-on-surface">By category</h3>
          <span className="text-body-sm text-on-surface-variant">Total <span className="tabular font-bold text-error">{fmtMoney(total)}</span></span>
        </div>
        {rows.length === 0 ? (
          <div className="p-8"><EmptyState icon="payments" title="No payouts in this period" hint="Cash payouts entered on Credit Entry show here." /></div>
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

      {dated.length > 0 && (
        <Card className="overflow-hidden mt-6">
          <div className="px-5 py-4 border-b border-outline-variant/60">
            <h3 className="font-semibold text-on-surface">Payout entries · {label}</h3>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Categories</th>
                  <th className="px-5 py-3">Receipts</th>
                  <th className="px-5 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {dated.map((d, i) => (
                  <tr key={d.date} className="hover:bg-surface-container-low/50">
                    <td className="px-5 py-3 tabular text-on-surface-variant">{d.date}</td>
                    <td className="px-5 py-3 text-on-surface">{d.items.map((it) => `${it.account} ${fmtMoney(it.amount)}`).join(" · ")}</td>
                    <td className="px-5 py-3"><ReceiptThumbs urls={datedReceipts[i] ?? []} /></td>
                    <td className="px-5 py-3 text-right tabular text-error">{fmtMoney(d.total)}</td>
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
