import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { getCreditManual, getHouseAccounts } from "@/lib/credit";
import { Card, PageHeader, EmptyState, Icon } from "@/components/ui";
import { saveCreditManual, addHouseAccount } from "./actions";

export const dynamic = "force-dynamic";

const HOUSE_ROWS = 5;

export default async function CreditEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "enterSales")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="You don't have permission to enter credit numbers." /></Card>;
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;
  const dateISO = sp.date || new Date().toISOString().slice(0, 10);
  const [existing, houseAccounts] = await Promise.all([
    loc ? getCreditManual(loc, dateISO) : Promise.resolve(null),
    getHouseAccounts(),
  ]);

  return (
    <div>
      <PageHeader
        title="Credit Entry"
        subtitle="Enter the day's EBT, other credit-card sales, cash payouts, and house-account charges."
        actions={
          <form className="flex items-end gap-2">
            <div>
              <label className="ft-label" htmlFor="pick">Day</label>
              <input id="pick" name="date" type="date" defaultValue={dateISO} className="ft-input" />
            </div>
            <button type="submit" className="ft-btn-ghost">Go</button>
          </form>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <form action={saveCreditManual} className="space-y-4">
            <input type="hidden" name="date" value={dateISO} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="ft-label" htmlFor="ebt">EBT Sales ($)</label>
                <input id="ebt" name="ebt" type="number" step="0.01" min="0" defaultValue={existing?.ebt ?? ""} className="ft-input" placeholder="0.00" />
              </div>
              <div>
                <label className="ft-label" htmlFor="otherCredit">Other Credit Card ($)</label>
                <input id="otherCredit" name="otherCredit" type="number" step="0.01" min="0" defaultValue={existing?.otherCredit ?? ""} className="ft-input" placeholder="0.00" />
              </div>
              <div>
                <label className="ft-label" htmlFor="payoutCash">Payout in Cash ($)</label>
                <input id="payoutCash" name="payoutCash" type="number" step="0.01" min="0" defaultValue={existing?.payoutCash ?? ""} className="ft-input" placeholder="0.00" />
              </div>
            </div>

            <div>
              <div className="ft-label mb-1">House Account charges</div>
              <div className="space-y-2">
                {Array.from({ length: HOUSE_ROWS }).map((_, i) => {
                  const row = existing?.house[i];
                  return (
                    <div key={i} className="grid grid-cols-2 gap-2">
                      <select name="houseAccount" defaultValue={row?.account ?? ""} className="ft-input">
                        <option value="">— Select account —</option>
                        {houseAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <input name="houseAmount" type="number" step="0.01" min="0" defaultValue={row?.amount ?? ""} className="ft-input" placeholder="0.00" />
                    </div>
                  );
                })}
              </div>
            </div>

            <button type="submit" className="ft-btn-primary"><Icon name="save" className="text-[18px]" /> Save entry · {dateISO}</button>
          </form>
        </Card>

        <Card className="p-5 h-fit">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="account_balance" className="text-primary text-[20px]" />
            <h3 className="font-semibold text-on-surface">House accounts</h3>
          </div>
          <p className="text-body-sm text-on-surface-variant mb-3">These appear in the dropdown. Add a new one here.</p>
          <ul className="text-body-sm mb-3 space-y-1">
            {houseAccounts.map((a) => (
              <li key={a} className="flex items-center gap-2"><Icon name="chevron_right" className="text-[16px] text-on-surface-variant" />{a}</li>
            ))}
          </ul>
          <form action={addHouseAccount} className="flex items-end gap-2">
            <div className="flex-1">
              <label className="ft-label" htmlFor="name">Add account</label>
              <input id="name" name="name" className="ft-input w-full" placeholder="e.g. ABC Church" />
            </div>
            <button type="submit" className="ft-btn-ghost">Add</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
