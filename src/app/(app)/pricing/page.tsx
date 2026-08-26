import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { money } from "@/lib/calc";
import { fmtMoney } from "@/lib/format";
import { marginPct, isBelowCost, fmtMargin } from "@/lib/pricing";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import PriceBook from "./PriceBook";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const session = (await getSession())!;
  if (!can(session.role, "viewAll")) {
    return (
      <Card className="p-8">
        <EmptyState icon="lock" title="No access" hint="Your role can't view pricing." />
      </Card>
    );
  }
  const loc = await getActiveLocationId();

  const products = await prisma.product.findMany({
    where: loc ? { locationId: loc } : {},
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      category: true,
      currentCost: true,
      sellingPrice: true,
      qtyOnHand: true,
    },
  });

  const priced = products.filter((p) => p.sellingPrice > 0);
  const unpriced = products.length - priced.length;
  const belowCost = products.filter((p) => isBelowCost(p.currentCost, p.sellingPrice)).length;
  const retailValue = money(products.reduce((s, p) => s + p.qtyOnHand * p.sellingPrice, 0));

  // Blended margin across the priced catalogue — weighted by stock on hand so a
  // slow-moving item can't skew the number the way a plain average would.
  const stockRetail = priced.reduce((s, p) => s + p.qtyOnHand * p.sellingPrice, 0);
  const stockCost = priced.reduce((s, p) => s + p.qtyOnHand * p.currentCost, 0);
  const blendedMargin = stockRetail > 0 ? marginPct(stockCost, stockRetail) : null;

  const canEdit = can(session.role, "enterPurchases");

  return (
    <div>
      <PageHeader
        title="Pricing"
        subtitle="Store price book — set shelf prices and reprice in bulk"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tile label="Products Priced" value={`${priced.length} / ${products.length}`} accent={unpriced ? "warning" : undefined} />
        <Tile label="Blended Margin" value={fmtMargin(blendedMargin)} />
        <Tile label="Priced At / Below Cost" value={String(belowCost)} accent={belowCost ? "error" : undefined} />
        <Tile label="Retail Value of Stock" value={fmtMoney(retailValue)} />
      </div>

      {products.length === 0 ? (
        <Card className="p-2">
          <EmptyState
            icon="sell"
            title="No products yet"
            hint="Add products on the Inventory page, then set their shelf prices here."
          />
        </Card>
      ) : (
        <PriceBook products={products} canEdit={canEdit} />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "warning" | "error";
}) {
  const tone =
    accent === "error" ? "text-error" : accent === "warning" ? "text-tertiary" : "text-on-surface";
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
      <div className={`tabular text-lg font-bold mt-1 ${tone}`}>{value}</div>
    </Card>
  );
}
