import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtNumber } from "@/lib/format";
import { marginPct, fmtMargin } from "@/lib/pricing";
import { readFilter, buildWhere } from "@/lib/pricebook/filter";
import { Card, PageHeader, EmptyState, Icon } from "@/components/ui";
import PriceBook from "./PriceBook";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

interface Summary {
  total: number;
  priced: number;
  no_cost: number;
  below_cost: number;
  margin_items: number;
  margin_cost: number;
  margin_retail: number;
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewAll")) {
    return (
      <Card className="p-8">
        <EmptyState icon="lock" title="No access" hint="Your role can't view pricing." />
      </Card>
    );
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;
  const filter = readFilter(sp);
  const page = Math.max(1, Number(sp.page) || 1);

  const where = buildWhere(loc ?? null, filter);

  // Catalogue-wide summary in one pass. Aggregating in SQL keeps this constant
  // time as the price book grows past 16k items.
  const summaryRows = loc
    ? await prisma.$queryRaw<Summary[]>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE "sellingPrice" > 0)::int AS priced,
          COUNT(*) FILTER (WHERE "currentCost" <= 0)::int AS no_cost,
          COUNT(*) FILTER (WHERE "sellingPrice" > 0 AND "currentCost" > 0
                             AND "sellingPrice" <= "currentCost")::int AS below_cost,
          COUNT(*) FILTER (WHERE "sellingPrice" > 0 AND "currentCost" > 0)::int AS margin_items,
          COALESCE(SUM("currentCost") FILTER (WHERE "sellingPrice" > 0 AND "currentCost" > 0), 0)::float AS margin_cost,
          COALESCE(SUM("sellingPrice") FILTER (WHERE "sellingPrice" > 0 AND "currentCost" > 0), 0)::float AS margin_retail
        FROM "Product"
        WHERE "locationId" = ${loc}
      `
    : [];
  const s: Summary = summaryRows[0] ?? {
    total: 0, priced: 0, no_cost: 0, below_cost: 0, margin_items: 0, margin_cost: 0, margin_retail: 0,
  };

  // Margin across every item that has both a price and a cost.
  const avgMargin = s.margin_retail > 0 ? marginPct(s.margin_cost, s.margin_retail) : null;

  const [matching, products, deptGroups] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ department: "asc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, name: true, upc: true, department: true, category: true,
        currentCost: true, sellingPrice: true, qtyOnHand: true, size: true,
      },
    }),
    prisma.product.groupBy({
      by: ["department"],
      where: loc ? { locationId: loc } : {},
      _count: { _all: true },
      orderBy: { department: "asc" },
    }),
  ]);

  const departments = deptGroups
    .filter((d) => d.department)
    .map((d) => ({ name: d.department as string, count: d._count._all }));

  const canEdit = can(session.role, "enterPurchases");
  const pageCount = Math.max(1, Math.ceil(matching / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Pricing"
        subtitle="Store price book — set shelf prices and reprice in bulk"
        actions={
          canEdit && (
            <Link href="/pricing/import" className="ft-btn-primary">
              <Icon name="upload_file" className="text-[18px]" /> Import Price Book
            </Link>
          )
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tile label="Products" value={fmtNumber(s.total)} hint={`${departments.length} departments`} />
        <Tile label="With a Price" value={fmtNumber(s.priced)} hint={s.total ? `${fmtNumber(s.total - s.priced)} unpriced` : undefined} />
        <Tile
          label="Missing Cost"
          value={fmtNumber(s.no_cost)}
          accent={s.no_cost > 0 ? "warning" : undefined}
          hint="Needed for margin"
        />
        <Tile
          label="Margin"
          value={fmtMargin(avgMargin)}
          accent={s.below_cost > 0 ? "error" : undefined}
          hint={s.margin_items ? `on ${fmtNumber(s.margin_items)} costed items` : "no costs on file yet"}
        />
      </div>

      {s.total === 0 ? (
        <Card className="p-2">
          <EmptyState
            icon="sell"
            title="No products yet"
            hint="Import your Modisoft Inventory export to load products, UPCs, departments and prices."
          />
        </Card>
      ) : (
        <PriceBook
          products={products}
          departments={departments}
          canEdit={canEdit}
          filter={filter}
          page={page}
          pageCount={pageCount}
          matching={matching}
          pageSize={PAGE_SIZE}
          belowCostCount={s.below_cost}
        />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "warning" | "error";
}) {
  const tone =
    accent === "error" ? "text-error" : accent === "warning" ? "text-tertiary" : "text-on-surface";
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
      <div className={`tabular text-lg font-bold mt-1 ${tone}`}>{value}</div>
      {hint && <div className="text-body-sm text-on-surface-variant mt-0.5 truncate">{hint}</div>}
    </Card>
  );
}
