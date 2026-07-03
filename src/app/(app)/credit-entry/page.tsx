import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { getCreditManual, getHouseAccounts, getPayoutTree } from "@/lib/credit";
import { todayISO } from "@/lib/day";
import { getReceipts } from "@/lib/receipts";
import { signedUrls, isStorageConfigured } from "@/lib/storage";
import { Card, PageHeader, EmptyState, Icon, Banner } from "@/components/ui";
import { saveCreditManual, addHouseAccountInline, addPayoutParentInline, addPayoutSubInline } from "./actions";
import LineItemEditor from "./LineItemEditor";
import PayoutTreeEditor from "./PayoutTreeEditor";
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
  const [existing, houseAccounts, payoutTree, receiptPaths] = await Promise.all([
    loc ? getCreditManual(loc, dateISO) : Promise.resolve(null),
    getHouseAccounts(),
    getPayoutTree(),
    loc ? getReceipts(loc, "credit", dateISO) : Promise.resolve([]),
  ]);
  const receiptUrls = await signedUrls(receiptPaths);

  // Split saved payouts ("Parent · Sub") back into the two-level rows.
  const payoutRows = (existing?.payouts ?? []).map((p) => {
    const idx = p.account.indexOf(" · ");
    return idx >= 0
      ? { parent: p.account.slice(0, idx), sub: p.account.slice(idx + 3), amount: p.amount }
      : { parent: p.account, sub: "", amount: p.amount };
  });

  return (
    <div>
      <PageHeader
        title="Credit Entry"
        subtitle="Enter the day's EBT, other credit-card sales, cash payouts, and house-account charges."
        actions={
          <form action="/daily" className="flex items-end gap-2">
            <div>
              <label className="ft-label" htmlFor="pick">Day</label>
              <input id="pick" name="date" type="date" defaultValue={dateISO} className="ft-input" />
            </div>
            <button type="submit" className="ft-btn-ghost" title="Open this day in Daily Sales">Go to Daily</button>
          </form>
        }
      />

      {sp.saved && (
        <Banner>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            Credit entry saved for {dateISO}.
            <a href={`/daily?date=${dateISO}`} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
              <Icon name="arrow_back" className="text-[16px]" /> Back to Daily Sales for {dateISO}
            </a>
          </span>
        </Banner>
      )}

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

          <PayoutTreeEditor
            tree={payoutTree}
            rows={payoutRows}
            addParentAction={addPayoutParentInline}
            addSubAction={addPayoutSubInline}
          />

          <LineItemEditor
            title="House Account charges"
            selectName="houseAccount"
            amountName="houseAmount"
            initialOptions={houseAccounts}
            rows={existing?.house ?? []}
            addAction={addHouseAccountInline}
          />

          <ReceiptInput existing={receiptUrls} configured={isStorageConfigured()} required={session.role !== "OWNER"} />

          <button type="submit" className="ft-btn-primary"><Icon name="save" className="text-[18px]" /> Save entry · {dateISO}</button>
        </form>
      </Card>
    </div>
  );
}
