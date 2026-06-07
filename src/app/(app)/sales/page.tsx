import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { dateWhere } from "@/lib/filters";
import { fmtMoney, fmtDate, catLabel, paymentLabel, gradeLabel, fmtNumber } from "@/lib/format";
import { grossSales, netSales, salesTaxCollected, type SaleLike } from "@/lib/calc";
import { Card, PageHeader, Badge, EmptyState, Icon } from "@/components/ui";
import Filters from "@/components/Filters";
import SaleForm from "./SaleForm";
import DeleteButton from "@/components/DeleteButton";
import { deleteSale } from "./actions";
import { toISODate } from "@/lib/period";

export const dynamic = "force-dynamic";

const CATEGORY_OPTS = ["FUEL", "STORE", "LOTTERY", "TOBACCO", "FOOD_DRINK", "OTHER"].map((v) => ({
  value: v,
  label: catLabel(v),
}));
const PAYMENT_OPTS = ["CASH", "CARD", "OTHER"].map((v) => ({ value: v, label: paymentLabel(v) }));

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  const sp = await searchParams;

  const where: Record<string, unknown> = { ...dateWhere(sp) };
  if (session.locationId) where.locationId = session.locationId;
  if (sp.category) where.category = sp.category;
  if (sp.payment) where.paymentType = sp.payment;

  const sales = await prisma.sale.findMany({
    where,
    include: { fuelSale: true },
    orderBy: { date: "desc" },
    take: 300,
  });

  const totals = {
    gross: grossSales(sales as SaleLike[]),
    net: netSales(sales as SaleLike[]),
    tax: salesTaxCollected(sales as SaleLike[]),
  };
  const canDelete = can(session.role, "editDelete");

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle="Record and review all sales by category, fuel grade, and payment type"
        actions={<SaleForm defaultDate={toISODate(new Date())} />}
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <SummaryTile label="Gross Sales" value={fmtMoney(totals.gross)} />
        <SummaryTile label="Net Sales" value={fmtMoney(totals.net)} />
        <SummaryTile label="Sales Tax (liability)" value={fmtMoney(totals.tax)} />
      </div>

      <Filters
        selects={[
          { name: "category", label: "Category", options: CATEGORY_OPTS },
          { name: "payment", label: "Payment", options: PAYMENT_OPTS },
        ]}
      />

      <Card className="overflow-hidden">
        {sales.length === 0 ? (
          <EmptyState
            icon="payments"
            title="No sales found"
            hint="Adjust your filters or record a new sale to get started."
          />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Detail</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Tax</th>
                  {canDelete && <th className="px-4 py-3"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {sales.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 whitespace-nowrap text-on-surface-variant">{fmtDate(s.date)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={s.category === "FUEL" ? "info" : "neutral"}>{catLabel(s.category)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {s.fuelSale
                        ? `${gradeLabel(s.fuelSale.grade)} · ${fmtNumber(s.fuelSale.gallons)} gal @ $${s.fuelSale.pricePerGallon.toFixed(4)}`
                        : s.note || "—"}
                      {s.refund > 0 && <span className="text-error ml-2">(-{fmtMoney(s.refund)} refund)</span>}
                    </td>
                    <td className="px-4 py-3">{paymentLabel(s.paymentType)}</td>
                    <td className="px-4 py-3 text-right tabular font-semibold">{fmtMoney(s.amount)}</td>
                    <td className="px-4 py-3 text-right tabular text-on-surface-variant">{fmtMoney(s.taxCollected)}</td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <DeleteButton id={s.id} action={deleteSale} label="Delete this sale?" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {sales.length === 300 && (
        <p className="text-body-sm text-on-surface-variant mt-2 flex items-center gap-1">
          <Icon name="info" className="text-[16px]" /> Showing the latest 300 entries. Narrow the date range to see more.
        </p>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className="tabular text-lg font-bold text-primary mt-1">{value}</div>
    </Card>
  );
}
