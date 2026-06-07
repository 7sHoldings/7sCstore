import { Card, TrendChip, Icon } from "./ui";
import { fmtMoney, fmtMoney4, fmtNumber, gradeLabel } from "@/lib/format";
import type { Split, Dept, FuelGrade } from "@/lib/salesView";

/** Summary card: big total + Cash / Credit-Debit sub-cells. */
export function MetricCard({
  label, sub, s, icon, trend, highlight,
}: {
  label: string; sub?: string; s: Split; icon: string; trend?: number | null; highlight?: boolean;
}) {
  return (
    <Card className={`p-5 ${highlight ? "ring-1 ring-primary/30" : ""}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-label-caps uppercase text-on-surface-variant">{label}</span>
        <Icon name={icon} className="text-[20px] text-primary opacity-70" />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular text-primary">{fmtMoney(s.total)}</span>
        {trend !== undefined && <TrendChip value={trend} />}
      </div>
      {sub && <p className="text-body-sm text-on-surface-variant mt-0.5">{sub}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 text-body-sm">
        <div className="bg-surface-container-low rounded-md px-2.5 py-1.5">
          <div className="text-label-caps uppercase text-on-surface-variant">Cash</div>
          <div className="tabular font-semibold">{fmtMoney(s.cash)}</div>
        </div>
        <div className="bg-surface-container-low rounded-md px-2.5 py-1.5">
          <div className="text-label-caps uppercase text-on-surface-variant">Credit/Debit</div>
          <div className="tabular font-semibold">{fmtMoney(s.card)}</div>
        </div>
      </div>
    </Card>
  );
}

function Pill({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className={`inline-flex flex-col items-end rounded-md px-2.5 py-1 ${strong ? "bg-primary text-on-primary" : "bg-surface-container-low"}`}>
      <span className={`text-[10px] uppercase tracking-wide ${strong ? "text-on-primary/80" : "text-on-surface-variant"}`}>{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </span>
  );
}

export function SalesSection({
  title, s, extra, className, children,
}: {
  title: string; s: Split; extra?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <Card className={`overflow-hidden ${className ?? ""}`}>
      <div className="px-5 py-4 border-b border-outline-variant/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h3 className="font-semibold text-on-surface">{title}</h3>
        <div className="flex items-center gap-2 text-body-sm">
          <Pill label="Cash" value={fmtMoney(s.cash)} />
          <Pill label="Credit/Debit" value={fmtMoney(s.card)} />
          <Pill label="Total" value={fmtMoney(s.total)} strong />
          {extra && <span className="text-on-surface-variant tabular">· {extra}</span>}
        </div>
      </div>
      {children}
    </Card>
  );
}

export function DeptTable({
  rows, total, refundTotal, allowNegative,
}: {
  rows: Dept[]; total: number; refundTotal: number; allowNegative?: boolean;
}) {
  if (rows.length === 0) {
    return <div className="text-on-surface-variant text-body-sm py-8 text-center">No activity this period.</div>;
  }
  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full text-left text-body-sm">
        <thead>
          <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
            <th className="px-5 py-3">Department</th>
            <th className="px-5 py-3 text-right">Sales</th>
            <th className="px-5 py-3 text-right">Refund</th>
            <th className="px-5 py-3 text-right">Sales %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant/40">
          {rows.map((d) => (
            <tr key={d.name} className="hover:bg-surface-container-low/50">
              <td className="px-5 py-3 font-medium text-on-surface">{d.name}</td>
              <td className={`px-5 py-3 text-right tabular ${allowNegative && d.sales < 0 ? "text-error" : ""}`}>{fmtMoney(d.sales)}</td>
              <td className={`px-5 py-3 text-right tabular ${d.refund > 0 ? "text-error" : "text-on-surface-variant"}`}>{d.refund > 0 ? `-${fmtMoney(d.refund)}` : "—"}</td>
              <td className="px-5 py-3 text-right tabular text-on-surface-variant">{total !== 0 ? `${((d.sales / total) * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-surface-container font-bold">
            <td className="px-5 py-3">Grand Total</td>
            <td className="px-5 py-3 text-right tabular">{fmtMoney(total)}</td>
            <td className="px-5 py-3 text-right tabular text-error">{refundTotal > 0 ? `-${fmtMoney(refundTotal)}` : "—"}</td>
            <td className="px-5 py-3 text-right tabular">100.0%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function FuelTable({ byGrade, gallons, total }: { byGrade: FuelGrade[]; gallons: number; total: number }) {
  if (byGrade.length === 0) {
    return <div className="text-on-surface-variant text-body-sm py-8 text-center">No fuel sales this period.</div>;
  }
  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full text-left text-body-sm">
        <thead>
          <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
            <th className="px-5 py-3">Grade</th>
            <th className="px-5 py-3 text-right">Gallons</th>
            <th className="px-5 py-3 text-right">Price / gal</th>
            <th className="px-5 py-3 text-right">Sales</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant/40">
          {byGrade.map((g) => (
            <tr key={g.grade} className="hover:bg-surface-container-low/50">
              <td className="px-5 py-3 font-medium text-on-surface">{gradeLabel(g.grade)}</td>
              <td className="px-5 py-3 text-right tabular">{fmtNumber(g.gallons)}</td>
              <td className="px-5 py-3 text-right tabular">{fmtMoney4(g.price)}</td>
              <td className="px-5 py-3 text-right tabular">{fmtMoney(g.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-surface-container font-bold">
            <td className="px-5 py-3">Total</td>
            <td className="px-5 py-3 text-right tabular">{fmtNumber(gallons)}</td>
            <td className="px-5 py-3"></td>
            <td className="px-5 py-3 text-right tabular">{fmtMoney(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
