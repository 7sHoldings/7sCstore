import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { dateWhere } from "@/lib/filters";
import { fmtMoney, fmtMoney4, fmtDate, gradeLabel, fmtNumber } from "@/lib/format";
import { purchaseMargin } from "@/lib/calc";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import Filters from "@/components/Filters";
import { PurchaseForm, FuelDeliveryForm } from "./PurchaseForms";
import DeleteButton from "@/components/DeleteButton";
import { deletePurchase, deleteFuelDelivery } from "./actions";
import { toISODate } from "@/lib/period";

export const dynamic = "force-dynamic";

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "enterPurchases") && !can(session.role, "viewAll")) return <NoAccess />;
  const sp = await searchParams;
  const loc = await getActiveLocationId();

  const baseWhere: Record<string, unknown> = { ...dateWhere(sp) };
  if (loc) baseWhere.locationId = loc;

  const [purchases, deliveries, vendors] = await Promise.all([
    prisma.purchase.findMany({ where: baseWhere, include: { vendor: true }, orderBy: { date: "desc" }, take: 200 }),
    prisma.fuelDelivery.findMany({ where: baseWhere, orderBy: { date: "desc" }, take: 100 }),
    prisma.vendor.findMany({ orderBy: { name: "asc" } }),
  ]);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));

  const purchaseTotal = purchases.reduce((s, p) => s + p.total, 0);
  const deliveryTotal = deliveries.reduce((s, d) => s + d.total, 0);
  const deliveryGallons = deliveries.reduce((s, d) => s + d.gallons, 0);
  const canDelete = can(session.role, "editDelete");
  const canAdd = can(session.role, "enterPurchases");
  const today = toISODate(new Date());
  const vendorOpts = vendors.map((v) => ({ id: v.id, name: v.name }));

  return (
    <div>
      <PageHeader
        title="Purchases & Deliveries"
        subtitle="Product intake, vendor invoices, and fuel deliveries"
        actions={
          canAdd && (
            <div className="flex gap-2">
              <FuelDeliveryForm defaultDate={today} vendors={vendorOpts} />
              <PurchaseForm defaultDate={today} vendors={vendorOpts} />
            </div>
          )
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile label="Product Purchases" value={fmtMoney(purchaseTotal)} />
        <Tile label="Fuel Deliveries" value={fmtMoney(deliveryTotal)} />
        <Tile label="Gallons Received" value={fmtNumber(deliveryGallons) + " gal"} />
        <Tile label="Vendors" value={String(vendors.length)} />
      </div>

      <Filters showDates />

      <Card className="overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">Product Purchases</div>
        {purchases.length === 0 ? (
          <EmptyState icon="inventory_2" title="No purchases found" hint="Record a product purchase to track cost and margin." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Cost ea.</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Margin</th>
                  <th className="px-4 py-3">Status</th>
                  {canDelete && <th></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 whitespace-nowrap text-on-surface-variant">{fmtDate(p.date)}</td>
                    <td className="px-4 py-3 font-medium text-on-surface">{p.productName}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{p.vendor?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{p.invoiceNo ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtNumber(p.qty)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(p.costEach)}</td>
                    <td className="px-4 py-3 text-right tabular font-semibold">{fmtMoney(p.total)}</td>
                    <td className="px-4 py-3 text-right tabular text-secondary">{purchaseMargin(p)}%</td>
                    <td className="px-4 py-3">
                      {p.paid ? <Badge tone="success">Paid</Badge> : <Badge tone="warning">Owed</Badge>}
                    </td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <DeleteButton id={p.id} action={deletePurchase} label="Delete this purchase?" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">Fuel Deliveries</div>
        {deliveries.length === 0 ? (
          <EmptyState icon="local_shipping" title="No fuel deliveries found" hint="Record deliveries to track cost and tax per gallon." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Grade</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3 text-right">Gallons</th>
                  <th className="px-4 py-3 text-right">Cost/gal</th>
                  <th className="px-4 py-3 text-right">Tax/gal</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  {canDelete && <th></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {deliveries.map((d) => (
                  <tr key={d.id} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 whitespace-nowrap text-on-surface-variant">{fmtDate(d.date)}</td>
                    <td className="px-4 py-3"><Badge tone="info">{gradeLabel(d.grade)}</Badge></td>
                    <td className="px-4 py-3 text-on-surface-variant">{(d.vendorId && vendorName.get(d.vendorId)) || "—"}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtNumber(d.gallons)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney4(d.costPerGallon)}</td>
                    <td className="px-4 py-3 text-right tabular text-on-surface-variant">{fmtMoney4(d.taxPerGallon)}</td>
                    <td className="px-4 py-3 text-right tabular font-semibold">{fmtMoney(d.total)}</td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <DeleteButton id={d.id} action={deleteFuelDelivery} label="Delete this delivery?" />
                      </td>
                    )}
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

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
      <div className="tabular text-lg font-bold text-on-surface mt-1">{value}</div>
    </Card>
  );
}

function NoAccess() {
  return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Your role can't view purchases." /></Card>;
}
