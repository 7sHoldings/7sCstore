import { Fragment } from "react";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { dateWhere } from "@/lib/filters";
import { fmtMoney, fmtDate } from "@/lib/format";
import { toISODate } from "@/lib/period";
import { Card, PageHeader, EmptyState, Icon } from "@/components/ui";
import DeleteButton from "@/components/DeleteButton";
import MoneyIncomingForm from "./MoneyIncomingForm";
import { deleteMoneyIncoming } from "./actions";

export const dynamic = "force-dynamic";

type Row = { rent: number; gameMachine: number; stagityInvestment: number; beer: number; total: number };
const COLS: [keyof Row, string, string][] = [
  ["rent", "Rent", "home_work"],
  ["gameMachine", "Game Machine", "casino"],
  ["stagityInvestment", "Stagity Investment", "savings"],
  ["beer", "Beer", "sports_bar"],
];

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

  // Group rows by month (already date-desc) for scannable subtotals.
  const groups: { key: string; label: string; rows: typeof items; total: number }[] = [];
  for (const i of items) {
    const key = `${i.date.getUTCFullYear()}-${i.date.getUTCMonth()}`;
    const label = i.date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, label, rows: [], total: 0 }; groups.push(g); }
    g.rows.push(i);
    g.total += i.total;
  }

  return (
    <div>
      <PageHeader
        title="Money Incoming"
        subtitle="Non-sales income — rent, game machine, investment, beer"
        actions={canAdd && <MoneyIncomingForm defaultDate={toISODate(new Date())} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Kpi label="Total Incoming" value={fmtMoney(grand)} icon="savings" tone="primary" featured />
        {COLS.map(([k, label, icon]) => (
          <Kpi key={k} label={label} value={fmtMoney(sum(k))} icon={icon} tone="secondary" />
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        {items.length === 0 ? (
          <EmptyState icon="savings" title="No income recorded" hint="Add an entry or import from Excel." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-body-sm whitespace-nowrap">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-container text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3 text-left font-semibold">Date</th>
                  {COLS.map(([k, label]) => <th key={k} className="px-4 py-3 text-right font-semibold">{label}</th>)}
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  {canDelete && <th className="w-10"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <tr className="bg-surface-container-low/70">
                      <td className="px-4 py-2 text-label-caps uppercase tracking-wide text-primary font-bold" colSpan={1 + COLS.length}>
                        {g.label}
                      </td>
                      <td className="px-4 py-2 text-right tabular font-bold text-primary">{fmtMoney(g.total)}</td>
                      {canDelete && <td></td>}
                    </tr>
                    {g.rows.map((i) => (
                      <tr key={i.id} className="hover:bg-primary/5 transition-colors">
                        <td className="px-4 py-3 text-on-surface-variant">{fmtDate(i.date)}</td>
                        {COLS.map(([k]) => (
                          <td key={k} className="px-4 py-3 text-right tabular">
                            {(i[k] as number) ? fmtMoney(i[k] as number) : <span className="text-on-surface-variant/35">—</span>}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right tabular font-semibold text-secondary">{fmtMoney(i.total)}</td>
                        {canDelete && (
                          <td className="px-2 py-3 text-right">
                            <DeleteButton id={i.id} action={deleteMoneyIncoming} label="Delete this income entry?" />
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0">
                <tr className="bg-surface-container font-bold text-on-surface border-t-2 border-outline-variant">
                  <td className="px-4 py-3">Grand Total</td>
                  {COLS.map(([k]) => <td key={k} className="px-4 py-3 text-right tabular">{fmtMoney(sum(k))}</td>)}
                  <td className="px-4 py-3 text-right tabular text-secondary">{fmtMoney(grand)}</td>
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

function Kpi({ label, value, icon, tone, featured }: { label: string; value: string; icon: string; tone: "primary" | "secondary"; featured?: boolean }) {
  const toneCls = tone === "primary" ? "text-primary bg-primary/10" : "text-secondary bg-secondary/10";
  return (
    <Card className={`p-4 flex items-center gap-3 ${featured ? "ring-1 ring-primary/20" : ""}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${toneCls}`}>
        <Icon name={icon} className="text-[20px]" />
      </div>
      <div className="min-w-0">
        <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
        <div className={`tabular font-bold text-on-surface mt-0.5 ${featured ? "text-xl" : "text-lg"}`}>{value}</div>
      </div>
    </Card>
  );
}
