import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { dateWhere } from "@/lib/filters";
import { fmtMoney, fmtDate } from "@/lib/format";
import { toISODate } from "@/lib/period";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import DeleteButton from "@/components/DeleteButton";
import MoneyIncomingForm from "./MoneyIncomingForm";
import { deleteMoneyIncoming } from "./actions";

export const dynamic = "force-dynamic";

const COLS: [keyof Row, string][] = [
  ["rent", "Rent"],
  ["gameMachine", "Game Machine"],
  ["stagityInvestment", "Stagity Investment"],
  ["beer", "Beer"],
];
type Row = { rent: number; gameMachine: number; stagityInvestment: number; beer: number; total: number };

export default async function MoneyIncomingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const sp = await searchParams;
  const loc = await getActiveLocationId();
  const where: Record<string, unknown> = { ...dateWhere(sp) };
  if (loc) where.locationId = loc;

  const items = await prisma.moneyIncoming.findMany({ where, orderBy: { date: "desc" }, take: 500 });
  const sum = (k: keyof Row) => items.reduce((s, i) => s + (i[k] as number), 0);
  const grand = sum("total");
  const canAdd = can(session.role, "enterSales");
  const canDelete = can(session.role, "editDelete");

  return (
    <div>
      <PageHeader
        title="Money Incoming"
        subtitle="Non-sales income — rent, game machine, investment, beer"
        actions={canAdd && <MoneyIncomingForm defaultDate={toISODate(new Date())} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Tile label="Total Incoming" value={fmtMoney(grand)} />
        {COLS.map(([k, label]) => (
          <Tile key={k} label={label} value={fmtMoney(sum(k))} />
        ))}
      </div>

      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <EmptyState icon="savings" title="No income recorded" hint="Add an entry or import from Excel." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm whitespace-nowrap">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Date</th>
                  {COLS.map(([k, label]) => <th key={k} className="px-4 py-3 text-right">{label}</th>)}
                  <th className="px-4 py-3 text-right">Total</th>
                  {canDelete && <th></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {items.map((i) => (
                  <tr key={i.id} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 text-on-surface-variant">{fmtDate(i.date)}</td>
                    {COLS.map(([k]) => (
                      <td key={k} className="px-4 py-3 text-right tabular">{(i[k] as number) ? fmtMoney(i[k] as number) : "—"}</td>
                    ))}
                    <td className="px-4 py-3 text-right tabular font-semibold text-secondary">{fmtMoney(i.total)}</td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <DeleteButton id={i.id} action={deleteMoneyIncoming} label="Delete this income entry?" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-container-low font-semibold text-on-surface border-t-2 border-outline-variant">
                  <td className="px-4 py-3">Total</td>
                  {COLS.map(([k]) => <td key={k} className="px-4 py-3 text-right tabular">{fmtMoney(sum(k))}</td>)}
                  <td className="px-4 py-3 text-right tabular">{fmtMoney(grand)}</td>
                  {canDelete && <td></td>}
                </tr>
              </tfoot>
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
