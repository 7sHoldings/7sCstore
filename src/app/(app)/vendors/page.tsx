import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { Card, PageHeader, Badge, EmptyState, Icon } from "@/components/ui";
import VendorForm from "./VendorForm";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const session = (await getSession())!;
  if (!can(session.role, "enterPurchases") && !can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }

  const vendors = await prisma.vendor.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { purchases: true } } },
  });
  const totalOwed = vendors.reduce((s, v) => s + v.balanceOwed, 0);
  const canAdd = can(session.role, "enterPurchases");

  return (
    <div>
      <PageHeader
        title="Vendors"
        subtitle="Suppliers, payment terms, and outstanding balances"
        actions={canAdd && <VendorForm />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <Tile label="Vendors" value={String(vendors.length)} />
        <Tile label="Total Owed" value={fmtMoney(totalOwed)} accent="error" />
        <Tile label="With Balance" value={String(vendors.filter((v) => v.balanceOwed > 0).length)} />
      </div>

      {vendors.length === 0 ? (
        <Card className="p-8"><EmptyState icon="store" title="No vendors yet" hint="Add a vendor to track purchases and balances." /></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {vendors.map((v) => (
            <Link key={v.id} href={`/vendors/${v.id}`}>
              <Card className="p-4 hover:shadow-floating transition-shadow h-full">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-md bg-surface-container flex items-center justify-center">
                      <Icon name="store" className="text-[20px] text-primary" />
                    </div>
                    <div>
                      <div className="font-semibold text-on-surface">{v.name}</div>
                      <div className="text-body-sm text-on-surface-variant">{v.terms || "No terms set"}</div>
                    </div>
                  </div>
                  {v.balanceOwed > 0 ? <Badge tone="warning">Owed</Badge> : <Badge tone="success">Clear</Badge>}
                </div>
                <div className="mt-3 flex items-center justify-between text-body-sm">
                  <span className="text-on-surface-variant">{v._count.purchases} purchases</span>
                  <span className="tabular font-semibold text-error">{fmtMoney(v.balanceOwed)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: "error" }) {
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className={`tabular text-lg font-bold mt-1 ${accent === "error" ? "text-error" : "text-on-surface"}`}>{value}</div>
    </Card>
  );
}
