import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { getLotteryManual } from "@/lib/lottery";
import { money } from "@/lib/calc";
import { fmtMoney } from "@/lib/format";
import { Card, PageHeader, EmptyState, Icon } from "@/components/ui";
import { saveLotteryManual } from "./actions";

export const dynamic = "force-dynamic";

export default async function LotteryEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "enterSales")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="You don't have permission to enter lottery numbers." /></Card>;
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;
  const dateISO = sp.date || new Date().toISOString().slice(0, 10);
  const existing = loc ? await getLotteryManual(loc, dateISO) : null;
  const net = existing ? money(existing.sales - existing.payout) : 0;

  return (
    <div>
      <PageHeader
        title="Lottery Entry"
        subtitle="Enter the day's lottery sales and lotto payout from the machine / register."
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

      <Card className="p-5 max-w-xl">
        <form action={saveLotteryManual} className="space-y-4">
          <input type="hidden" name="date" value={dateISO} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="ft-label" htmlFor="sales">Lottery Sales ($)</label>
              <input id="sales" name="sales" type="number" step="0.01" min="0" defaultValue={existing?.sales ?? ""} className="ft-input" placeholder="0.00" required />
            </div>
            <div>
              <label className="ft-label" htmlFor="payout">Lotto Payout ($)</label>
              <input id="payout" name="payout" type="number" step="0.01" min="0" defaultValue={existing?.payout ?? ""} className="ft-input" placeholder="0.00" required />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md bg-surface-container-low px-3 py-2">
            <span className="text-label-caps uppercase text-on-surface-variant">Net (sales − payout)</span>
            <span className="tabular font-bold">{fmtMoney(net)}</span>
          </div>

          <div className="flex items-center gap-2">
            <button type="submit" className="ft-btn-primary"><Icon name="save" className="text-[18px]" /> Save entry</button>
            <span className="text-body-sm text-on-surface-variant">for {dateISO}</span>
          </div>
        </form>
      </Card>
    </div>
  );
}
