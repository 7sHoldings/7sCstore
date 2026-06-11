import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { getCreditManual, getHouseAccounts, getPayoutCategories } from "@/lib/credit";
import { Card, PageHeader, EmptyState, Icon, Banner } from "@/components/ui";
import { saveCreditManual, addHouseAccount, addPayoutCategory } from "./actions";

export const dynamic = "force-dynamic";

const ROWS = 5;

export default async function CreditEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; saved?: string; added?: string; addedp?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "enterSales")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="You don't have permission to enter credit numbers." /></Card>;
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;
  const dateISO = sp.date || new Date().toISOString().slice(0, 10);
  const [existing, houseAccounts, payoutCategories] = await Promise.all([
    loc ? getCreditManual(loc, dateISO) : Promise.resolve(null),
    getHouseAccounts(),
    getPayoutCategories(),
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

      {sp.saved && <Banner>Credit entry saved for {dateISO}.</Banner>}
      {sp.added && <Banner>House account &ldquo;{sp.added}&rdquo; added.</Banner>}
      {sp.addedp && <Banner>Payout category &ldquo;{sp.addedp}&rdquo; added.</Banner>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <form action={saveCreditManual} className="space-y-5">
            <input type="hidden" name="date" value={dateISO} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="ft-label" htmlFor="ebt">EBT Sales ($)</label>
                <input id="ebt" name="ebt" type="number" step="0.01" min="0" defaultValue={existing?.ebt ?? ""} className="ft-input" placeholder="0.00" />
              </div>
              <div>
                <label className="ft-label" htmlFor="otherCredit">Other Credit Card ($)</label>
                <input id="otherCredit" name="otherCredit" type="number" step="0.01" min="0" defaultValue={existing?.otherCredit ?? ""} className="ft-input" placeholder="0.00" />
              </div>
            </div>

            <LineRows
              title="Payout in Cash"
              selectName="payoutCategory"
              amountName="payoutAmount"
              options={payoutCategories}
              rows={existing?.payouts ?? []}
            />

            <LineRows
              title="House Account charges"
              selectName="houseAccount"
              amountName="houseAmount"
              options={houseAccounts}
              rows={existing?.house ?? []}
            />

            <button type="submit" className="ft-btn-primary"><Icon name="save" className="text-[18px]" /> Save entry · {dateISO}</button>
          </form>
        </Card>

        <div className="space-y-4">
          <ListManager
            title="Payout categories"
            icon="payments"
            items={payoutCategories}
            action={addPayoutCategory}
            dateISO={dateISO}
            placeholder="e.g. Vendor Cash"
          />
          <ListManager
            title="House accounts"
            icon="account_balance"
            items={houseAccounts}
            action={addHouseAccount}
            dateISO={dateISO}
            placeholder="e.g. ABC Church"
          />
        </div>
      </div>
    </div>
  );
}

function LineRows({
  title, selectName, amountName, options, rows,
}: {
  title: string;
  selectName: string;
  amountName: string;
  options: string[];
  rows: { account: string; amount: number }[];
}) {
  return (
    <div>
      <div className="ft-label mb-1">{title}</div>
      <div className="space-y-2">
        {Array.from({ length: ROWS }).map((_, i) => {
          const row = rows[i];
          return (
            <div key={i} className="grid grid-cols-2 gap-2">
              <select name={selectName} defaultValue={row?.account ?? ""} className="ft-input">
                <option value="">— Select —</option>
                {options.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <input name={amountName} type="number" step="0.01" min="0" defaultValue={row?.amount ?? ""} className="ft-input" placeholder="0.00" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListManager({
  title, icon, items, action, dateISO, placeholder,
}: {
  title: string;
  icon: string;
  items: string[];
  action: (formData: FormData) => void;
  dateISO: string;
  placeholder: string;
}) {
  return (
    <Card className="p-5 h-fit">
      <div className="flex items-center gap-2 mb-1">
        <Icon name={icon} className="text-primary text-[20px]" />
        <h3 className="font-semibold text-on-surface">{title}</h3>
      </div>
      <p className="text-body-sm text-on-surface-variant mb-3">These appear in the dropdown. Add a new one here.</p>
      <ul className="text-body-sm mb-3 space-y-1">
        {items.map((a) => (
          <li key={a} className="flex items-center gap-2"><Icon name="chevron_right" className="text-[16px] text-on-surface-variant" />{a}</li>
        ))}
      </ul>
      <form action={action} className="flex items-end gap-2">
        <input type="hidden" name="date" value={dateISO} />
        <div className="flex-1">
          <label className="ft-label" htmlFor={`add-${title}`}>Add</label>
          <input id={`add-${title}`} name="name" className="ft-input w-full" placeholder={placeholder} />
        </div>
        <button type="submit" className="ft-btn-ghost">Add</button>
      </form>
    </Card>
  );
}
