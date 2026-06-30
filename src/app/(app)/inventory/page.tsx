import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtMoney, fmtNumber, fmtDate, catLabel, gradeLabel } from "@/lib/format";
import { money } from "@/lib/calc";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import { FuelReadingForm, ProductForm } from "./InventoryForms";
import { reorderSuggestions } from "@/lib/reorder";
import { marginOf } from "@/lib/pricing";
import { toISODate } from "@/lib/period";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const session = (await getSession())!;
  if (!can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Your role can't view inventory." /></Card>;
  }
  const loc = await getActiveLocationId();

  const [products, fuelReadings, suggestions, vendors] = await Promise.all([
    prisma.product.findMany({ where: loc ? { locationId: loc } : {}, orderBy: { name: "asc" } }),
    prisma.fuelInventory.findMany({ where: loc ? { locationId: loc } : {}, orderBy: { date: "desc" }, take: 40 }),
    reorderSuggestions(loc),
    prisma.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));

  const inventoryValue = money(products.reduce((s, p) => s + p.qtyOnHand * p.currentCost, 0));
  const lowStock = products.filter((p) => p.lowThreshold != null && p.qtyOnHand <= p.lowThreshold);

  // Latest reading per grade.
  const latestByGrade = new Map<string, (typeof fuelReadings)[number]>();
  for (const r of fuelReadings) {
    if (!latestByGrade.has(r.grade)) latestByGrade.set(r.grade, r);
  }
  const today = toISODate(new Date());
  const canEdit = can(session.role, "enterPurchases");

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Store stock value and fuel tank reconciliation"
        actions={
          canEdit && (
            <div className="flex gap-2">
              <FuelReadingForm defaultDate={today} />
              <ProductForm vendors={vendors} />
            </div>
          )
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tile label="Inventory Value" value={fmtMoney(inventoryValue)} />
        <Tile label="Products" value={String(products.length)} />
        <Tile label="Low Stock" value={String(lowStock.length)} accent={lowStock.length ? "warning" : undefined} />
        <Tile label="Fuel Grades Tracked" value={String(latestByGrade.size)} />
      </div>

      {/* Reorder suggestions */}
      {suggestions.length > 0 && (
        <Card className="overflow-hidden mb-6 border-tertiary/40">
          <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-tertiary text-[20px]">shopping_cart</span>
            Reorder Suggestions
            <Badge tone="warning">{suggestions.length}</Badge>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3 text-right">On Hand</th>
                  <th className="px-4 py-3 text-right">Threshold</th>
                  <th className="px-4 py-3 text-right">Suggested Order</th>
                  <th className="px-4 py-3 text-right">Est. Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {suggestions.map((s) => (
                  <tr key={s.productId} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 font-medium text-on-surface">{s.name}</td>
                    <td className="px-4 py-3 text-right tabular text-error">{fmtNumber(s.qtyOnHand)}</td>
                    <td className="px-4 py-3 text-right tabular text-on-surface-variant">{fmtNumber(s.threshold)}</td>
                    <td className="px-4 py-3 text-right tabular font-semibold text-primary">{fmtNumber(s.suggestedQty)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtMoney(s.estimatedCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Fuel reconciliation */}
      <Card className="overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">Fuel Tank Reconciliation</div>
        {latestByGrade.size === 0 ? (
          <EmptyState icon="gas_meter" title="No tank readings yet" hint="Record a reading to compare book vs physical gallons." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Grade</th>
                  <th className="px-4 py-3">Last Reading</th>
                  <th className="px-4 py-3 text-right">Book (gal)</th>
                  <th className="px-4 py-3 text-right">Physical (gal)</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {[...latestByGrade.values()].map((r) => (
                  <tr key={r.id} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3"><Badge tone="info">{gradeLabel(r.grade)}</Badge></td>
                    <td className="px-4 py-3 text-on-surface-variant">{fmtDate(r.date)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtNumber(r.gallonsBook)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtNumber(r.gallonsPhysical)}</td>
                    <td className={`px-4 py-3 text-right tabular font-semibold ${r.variance < 0 ? "text-error" : "text-secondary"}`}>
                      {r.variance > 0 ? "+" : ""}{fmtNumber(r.variance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Store products */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">Store Inventory</div>
        {products.length === 0 ? (
          <EmptyState icon="inventory_2" title="No products yet" hint="Add products to track stock and value." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3 text-right">On Hand</th>
                  <th className="px-4 py-3 text-right">Reorder At</th>
                  <th className="px-4 py-3 text-right">Unit Cost</th>
                  <th className="px-4 py-3 text-right">Retail</th>
                  <th className="px-4 py-3 text-right">Margin</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {products.map((p) => {
                  const low = p.lowThreshold != null && p.qtyOnHand <= p.lowThreshold;
                  const margin = marginOf(p.currentCost, p.sellingPrice);
                  return (
                    <tr key={p.id} className="hover:bg-surface-container-low/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-on-surface">{p.name}</div>
                        <div className="text-on-surface-variant text-[11px]">{catLabel(p.category)}{p.unitsPerCase > 1 ? ` · ${p.unitsPerCase}/case` : ""}</div>
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">{(p.vendorId && vendorName.get(p.vendorId)) || "—"}</td>
                      <td className="px-4 py-3 text-right tabular font-medium">{fmtNumber(p.qtyOnHand)}</td>
                      <td className="px-4 py-3 text-right tabular text-on-surface-variant">{p.lowThreshold != null ? fmtNumber(p.lowThreshold) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular">{fmtMoney(p.currentCost)}</td>
                      <td className="px-4 py-3 text-right tabular">{fmtMoney(p.sellingPrice)}</td>
                      <td className="px-4 py-3 text-right tabular text-on-surface-variant">{margin > 0 ? `${margin}%` : "—"}</td>
                      <td className="px-4 py-3 text-right tabular font-semibold">{fmtMoney(p.qtyOnHand * p.currentCost)}</td>
                      <td className="px-4 py-3">{low ? <Badge tone="warning">Reorder</Badge> : <Badge tone="success">OK</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: "warning" }) {
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
      <div className={`tabular text-lg font-bold mt-1 ${accent === "warning" ? "text-tertiary" : "text-on-surface"}`}>{value}</div>
    </Card>
  );
}
