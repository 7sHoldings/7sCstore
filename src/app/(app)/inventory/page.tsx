import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtMoney, fmtNumber, fmtDate, catLabel, gradeLabel } from "@/lib/format";
import { money } from "@/lib/calc";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import { FuelReadingForm, ProductForm } from "./InventoryForms";
import { toISODate } from "@/lib/period";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const session = (await getSession())!;
  if (!can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Your role can't view inventory." /></Card>;
  }
  const loc = session.locationId ?? undefined;

  const [products, fuelReadings] = await Promise.all([
    prisma.product.findMany({ where: loc ? { locationId: loc } : {}, orderBy: { name: "asc" } }),
    prisma.fuelInventory.findMany({ where: loc ? { locationId: loc } : {}, orderBy: { date: "desc" }, take: 40 }),
  ]);

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
              <ProductForm />
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
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-right">On Hand</th>
                  <th className="px-4 py-3 text-right">Unit Cost</th>
                  <th className="px-4 py-3 text-right">Sell Price</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {products.map((p) => {
                  const low = p.lowThreshold != null && p.qtyOnHand <= p.lowThreshold;
                  return (
                    <tr key={p.id} className="hover:bg-surface-container-low/50">
                      <td className="px-4 py-3 font-medium text-on-surface">{p.name}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{catLabel(p.category)}</td>
                      <td className="px-4 py-3 text-right tabular">{fmtNumber(p.qtyOnHand)}</td>
                      <td className="px-4 py-3 text-right tabular">{fmtMoney(p.currentCost)}</td>
                      <td className="px-4 py-3 text-right tabular">{fmtMoney(p.sellingPrice)}</td>
                      <td className="px-4 py-3 text-right tabular font-semibold">{fmtMoney(p.qtyOnHand * p.currentCost)}</td>
                      <td className="px-4 py-3">{low ? <Badge tone="warning">Low</Badge> : <Badge tone="success">OK</Badge>}</td>
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
