import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtMoney, fmtDate } from "@/lib/format";
import { purchaseMargin } from "@/lib/calc";
import { Card, PageHeader, Badge, EmptyState, Icon } from "@/components/ui";
import PaymentButton from "./PaymentButton";

export const dynamic = "force-dynamic";

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "enterPurchases") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const { id } = await params;

  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: {
      purchases: { orderBy: { date: "desc" }, take: 100 },
    },
  });
  if (!vendor) notFound();

  const totalPurchased = vendor.purchases.reduce((s, p) => s + p.total, 0);
  const canPay = can(session.role, "enterExpenses");

  return (
    <div>
      <Link href="/vendors" className="ft-btn-ghost mb-2 -ml-3">
        <Icon name="arrow_back" className="text-[18px]" /> Vendors
      </Link>
      <PageHeader
        title={vendor.name}
        subtitle={vendor.contact || "No contact on file"}
        actions={canPay && <PaymentButton id={vendor.id} balance={vendor.balanceOwed} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tile label="Balance Owed" value={fmtMoney(vendor.balanceOwed)} accent={vendor.balanceOwed > 0 ? "error" : "success"} />
        <Tile label="Payment Terms" value={vendor.terms || "—"} />
        <Tile label="Total Purchased" value={fmtMoney(totalPurchased)} />
        <Tile label="Purchases" value={String(vendor.purchases.length)} />
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">Purchase History</div>
        {vendor.purchases.length === 0 ? (
          <EmptyState icon="inventory_2" title="No purchases from this vendor yet" />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Margin</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {vendor.purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">{fmtDate(p.date)}</td>
                    <td className="px-4 py-3 font-medium text-on-surface">{p.productName}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{p.invoiceNo ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular">{p.qty}</td>
                    <td className="px-4 py-3 text-right tabular font-semibold">{fmtMoney(p.total)}</td>
                    <td className="px-4 py-3 text-right tabular text-secondary">{purchaseMargin(p)}%</td>
                    <td className="px-4 py-3">{p.paid ? <Badge tone="success">Paid</Badge> : <Badge tone="warning">Owed</Badge>}</td>
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

function Tile({ label, value, accent }: { label: string; value: string; accent?: "error" | "success" }) {
  const color = accent === "error" ? "text-error" : accent === "success" ? "text-secondary" : "text-on-surface";
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className={`tabular text-lg font-bold mt-1 ${color}`}>{value}</div>
    </Card>
  );
}
