import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtMoney, fmtDate } from "@/lib/format";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import BankImport from "./BankImport";

export const dynamic = "force-dynamic";

export default async function BankPage() {
  const session = (await getSession())!;
  if (!can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();

  const txns = await prisma.bankTransaction.findMany({
    where: loc ? { locationId: loc } : {},
    orderBy: { date: "desc" },
    take: 300,
  });

  const debits = txns.filter((t) => t.kind === "DEBIT").reduce((s, t) => s + t.amount, 0);
  const credits = txns.filter((t) => t.kind === "CREDIT").reduce((s, t) => s + t.amount, 0);
  const unmatched = txns.filter((t) => t.kind === "DEBIT" && !t.matched).length;

  return (
    <div>
      <PageHeader title="Banking" subtitle="Import bank statements and reconcile against recorded expenses" />

      <div className="max-w-2xl mb-6">
        <BankImport />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile label="Transactions" value={String(txns.length)} />
        <Tile label="Total Debits" value={fmtMoney(debits)} accent="error" />
        <Tile label="Total Credits" value={fmtMoney(credits)} accent="success" />
        <Tile label="Unmatched Debits" value={String(unmatched)} accent={unmatched ? "warning" : undefined} />
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">Imported Transactions</div>
        {txns.length === 0 ? (
          <EmptyState icon="account_balance" title="No bank data yet" hint="Import a statement CSV above." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Reconciliation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {txns.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 whitespace-nowrap text-on-surface-variant">{fmtDate(t.date)}</td>
                    <td className="px-4 py-3 text-on-surface">{t.description}</td>
                    <td className="px-4 py-3">
                      {t.kind === "DEBIT" ? <Badge tone="error">Debit</Badge> : <Badge tone="success">Credit</Badge>}
                    </td>
                    <td className={`px-4 py-3 text-right tabular font-semibold ${t.kind === "DEBIT" ? "text-error" : "text-secondary"}`}>
                      {t.kind === "DEBIT" ? "−" : "+"}{fmtMoney(t.amount)}
                    </td>
                    <td className="px-4 py-3">
                      {t.kind === "CREDIT" ? (
                        <span className="text-on-surface-variant">—</span>
                      ) : t.matched ? (
                        <Badge tone="success">Matched</Badge>
                      ) : (
                        <Badge tone="warning">Unmatched</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: "error" | "success" | "warning" }) {
  const color = accent === "error" ? "text-error" : accent === "success" ? "text-secondary" : accent === "warning" ? "text-tertiary" : "text-on-surface";
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
      <div className={`tabular text-lg font-bold mt-1 ${color}`}>{value}</div>
    </Card>
  );
}
