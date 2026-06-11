import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { getCreditManual, getHouseAccounts, getPayoutCategories } from "@/lib/credit";
import { todayISO } from "@/lib/day";
import { getReceipts } from "@/lib/receipts";
import { signedUrls, isStorageConfigured } from "@/lib/storage";
import { Card, PageHeader, EmptyState, Icon, Banner } from "@/components/ui";
import { saveCreditManual, addPayoutCategoryInline, addHouseAccountInline } from "./actions";
import LineItemEditor from "./LineItemEditor";
import ReceiptInput from "./ReceiptInput";

export const dynamic = "force-dynamic";

export default async function CreditEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; saved?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "enterSales")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="You don't have permission to enter credit numbers." /></Card>;
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;
  const dateISO = sp.date || todayISO();
  const [existing, houseAccounts, payoutCategories, receiptPaths] = await Promise.all([
    loc ? getCreditManual(loc, dateISO) : Promise.resolve(null),
    getHouseAccounts(),
    getPayoutCategories(),
    loc ? getReceipts(loc, "credit", dateISO) : Promise.resolve([]),
  ]);
  const receiptUrls = await signedUrls(receiptPaths);

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

      <Card className="p-5 max-w-3xl">
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

          <LineItemEditor
            title="Payout in Cash"
            selectName="payoutCategory"
            amountName="payoutAmount"
            initialOptions={payoutCategories}
            rows={existing?.payouts ?? []}
            addAction={addPayoutCategoryInline}
          />

          <LineItemEditor
            title="House Account charges"
            selectName="houseAccount"
            amountName="houseAmount"
            initialOptions={houseAccounts}
            rows={existing?.house ?? []}
            addAction={addHouseAccountInline}
          />

          <ReceiptInput existing={receiptUrls} configured={isStorageConfigured()} required />

          <button type="submit" className="ft-btn-primary"><Icon name="save" className="text-[18px]" /> Save entry · {dateISO}</button>
        </form>
      </Card>
    </div>
  );
}
