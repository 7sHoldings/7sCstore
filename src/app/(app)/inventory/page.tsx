import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtMoney, fmtNumber, fmtDate, catLabel, gradeLabel } from "@/lib/format";
import { money } from "@/lib/calc";
import { Card, PageHeader, Badge, EmptyState, Icon } from "@/components/ui";
import { FuelReadingForm, ProductForm } from "./InventoryForms";
import PullInventoryButton from "./PullInventoryButton";
import EditProductButton from "./EditProductButton";
import BulkPushButton from "./BulkPushButton";
import InventoryFilters from "./InventoryFilters";
import { reorderSuggestions } from "@/lib/reorder";
import { marginOf } from "@/lib/pricing";
import { toISODate } from "@/lib/period";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // the Modisoft inventory pull (~16k items) can run long

const CATEGORIES = ["FUEL", "STORE", "FOOD_DRINK", "TOBACCO", "LOTTERY", "OTHER"];
const PAGE_SIZE = 100;

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; dept?: string; page?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Your role can't view inventory." /></Card>;
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const cat = CATEGORIES.includes(sp.cat || "") ? sp.cat! : "";
  const dept = sp.dept?.trim() || "";
  const page = Math.max(1, Number(sp.page) || 1);

  const baseWhere = loc ? { locationId: loc } : {};
  const productWhere = {
    ...baseWhere,
    ...(cat ? { category: cat as never } : {}),
    ...(dept ? { department: dept } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { upc: { contains: q } }] } : {}),
  };

  const [products, productCount, filteredCount, pushableCount, deptRows, fuelReadings, suggestions, vendors] = await Promise.all([
    prisma.product.findMany({ where: productWhere, orderBy: { name: "asc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.product.count({ where: baseWhere }),
    prisma.product.count({ where: productWhere }),
    prisma.product.count({ where: { ...productWhere, posItemId: { not: null }, posDeptId: { not: null } } }),
    prisma.product.findMany({ where: { ...baseWhere, department: { not: null } }, distinct: ["department"], select: { department: true }, orderBy: { department: "asc" } }),
    prisma.fuelInventory.findMany({ where: loc ? { locationId: loc } : {}, orderBy: { date: "desc" }, take: 40 }),
    reorderSuggestions(loc),
    prisma.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const departments = deptRows.map((d) => d.department!).filter(Boolean);
  const pageCount = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const qs = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(cat ? { cat } : {}), ...(dept ? { dept } : {}), page: String(p) })}`;
  const scopeLabel = dept || (cat ? catLabel(cat) : "") || "this view";

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
            <div className="flex gap-2 items-center flex-wrap">
              <PullInventoryButton />
              <FuelReadingForm defaultDate={today} />
              <ProductForm vendors={vendors} />
            </div>
          )
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tile label="Inventory Value" value={fmtMoney(inventoryValue)} />
        <Tile label="Products" value={String(productCount)} />
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
        <div className="px-4 py-3 border-b border-outline-variant/60 flex items-center justify-between gap-3 flex-wrap">
          <span className="font-semibold text-on-surface">
            Store Inventory
            <span className="text-on-surface-variant font-normal text-body-sm ml-2">
              {q || cat ? `${filteredCount.toLocaleString()} of ${productCount.toLocaleString()}` : `${productCount.toLocaleString()} items`}
            </span>
          </span>
          <div className="flex gap-2 flex-wrap items-center">
            {canEdit && (
              <a
                href={`/api/inventory/export?${new URLSearchParams({ ...(q ? { q } : {}), ...(cat ? { cat } : {}), ...(dept ? { dept } : {}) })}`}
                className="ft-btn-secondary h-9 whitespace-nowrap"
                title="Download this view as a CSV to bulk-edit prices"
              >
                <Icon name="download" className="text-[18px]" /> Export CSV
              </a>
            )}
            {canEdit && (cat || dept) && pushableCount > 0 && (
              <BulkPushButton filter={{ q, cat, dept }} count={pushableCount} scopeLabel={scopeLabel} />
            )}
            <InventoryFilters q={q} cat={cat} dept={dept} departments={departments} categories={CATEGORIES} />
          </div>
        </div>
        {products.length === 0 ? (
          <EmptyState icon="inventory_2" title={q ? "No matches" : "No products yet"} hint={q ? "Try another search." : "Add products or pull from Modisoft."} />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3 text-right">On Hand</th>
                  <th className="px-4 py-3 text-right">Reorder At</th>
                  <th className="px-4 py-3 text-right">Unit Cost</th>
                  <th className="px-4 py-3 text-right">Retail</th>
                  <th className="px-4 py-3 text-right">Margin</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3">Status</th>
                  {canEdit && <th className="px-2 py-3"></th>}
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
                      <td className="px-4 py-3 text-on-surface-variant">{p.department || "—"}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{(p.vendorId && vendorName.get(p.vendorId)) || "—"}</td>
                      <td className="px-4 py-3 text-right tabular font-medium">{fmtNumber(p.qtyOnHand)}</td>
                      <td className="px-4 py-3 text-right tabular text-on-surface-variant">{p.lowThreshold != null ? fmtNumber(p.lowThreshold) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular">{fmtMoney(p.currentCost)}</td>
                      <td className="px-4 py-3 text-right tabular">{fmtMoney(p.sellingPrice)}</td>
                      <td className="px-4 py-3 text-right tabular text-on-surface-variant">{margin > 0 ? `${margin}%` : "—"}</td>
                      <td className="px-4 py-3 text-right tabular font-semibold">{fmtMoney(p.qtyOnHand * p.currentCost)}</td>
                      <td className="px-4 py-3">{low ? <Badge tone="warning">Reorder</Badge> : <Badge tone="success">OK</Badge>}</td>
                      {canEdit && (
                        <td className="px-2 py-3 text-right">
                          <EditProductButton
                            vendors={vendors}
                            product={{
                              id: p.id, name: p.name, sellingPrice: p.sellingPrice, caseCost: p.caseCost,
                              unitsPerCase: p.unitsPerCase, marginPct: p.marginPct, vendorId: p.vendorId,
                              qtyOnHand: p.qtyOnHand, lowThreshold: p.lowThreshold, parLevel: p.parLevel,
                              posLinked: p.posItemId != null && p.posDeptId != null,
                            }}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-outline-variant/60 text-body-sm">
            <span className="text-on-surface-variant">Page {page} of {pageCount.toLocaleString()}</span>
            <div className="flex gap-2">
              {page > 1 ? <a href={qs(page - 1)} className="ft-btn-secondary h-8">Prev</a> : <span className="ft-btn-secondary h-8 opacity-40 pointer-events-none">Prev</span>}
              {page < pageCount ? <a href={qs(page + 1)} className="ft-btn-secondary h-8">Next</a> : <span className="ft-btn-secondary h-8 opacity-40 pointer-events-none">Next</span>}
            </div>
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
