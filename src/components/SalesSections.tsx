import { Card, TrendChip, Icon } from "./ui";
import { fmtMoney, fmtMoney4, fmtNumber, gradeLabel } from "@/lib/format";
import type { Split, Dept, FuelGrade } from "@/lib/salesView";

/**
 * Summary card: big total + sub-cells. By default the sub-cells show the
 * Cash / Credit-Debit split; pass `cells` to override them (e.g. Promotions),
 * or `cells={[]}` for no sub-cells. Optionally a link.
 */
export function MetricCard({
  label, sub, s, icon, trend, highlight, href, cells,
}: {
  label: string; sub?: string; s: Split; icon: string; trend?: number | null; highlight?: boolean; href?: string;
  cells?: { label: string; value: string; tone?: "error" }[];
}) {
  const shown = cells ?? [
    { label: "Cash", value: fmtMoney(s.cash) },
    { label: "Credit/Debit", value: fmtMoney(s.card) },
  ];
  const card = (
    <Card className={`p-5 h-full transition-shadow ${highlight ? "ring-1 ring-primary/30" : ""} ${href ? "hover:shadow-floating cursor-pointer" : ""}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-label-caps uppercase text-on-surface-variant">{label}</span>
        <Icon name={icon} className="text-[20px] text-primary opacity-70" />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular text-primary">{fmtMoney(s.total)}</span>
        {trend !== undefined && <TrendChip value={trend} />}
      </div>
      {sub && <p className="text-body-sm text-on-surface-variant mt-0.5">{sub}</p>}
      {shown.length > 0 && (
        <div className={`mt-3 grid gap-2 text-body-sm ${shown.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {shown.map((c) => (
            <div key={c.label} className="bg-surface-container-low rounded-md px-2.5 py-1.5">
              <div className="text-label-caps uppercase text-on-surface-variant">{c.label}</div>
              <div className={`tabular font-semibold ${c.tone === "error" ? "text-error" : ""}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
  return href ? <a href={href} className="block">{card}</a> : card;
}

/** Single-value summary card (e.g. Sales Tax) — big number, no cash/card split. */
export function InfoCard({
  label, value, sub, icon, highlight, href,
}: {
  label: string; value: string; sub?: string; icon: string; highlight?: boolean; href?: string;
}) {
  const card = (
    <Card className={`p-5 h-full flex flex-col transition-shadow ${highlight ? "ring-1 ring-primary/30" : ""} ${href ? "hover:shadow-floating cursor-pointer" : ""}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-label-caps uppercase text-on-surface-variant">{label}</span>
        <Icon name={icon} className="text-[20px] text-primary opacity-70" />
      </div>
      <div className="flex-1 flex flex-col justify-center">
        <div className="text-2xl font-bold tabular text-primary">{value}</div>
        {sub && <p className="text-body-sm text-on-surface-variant mt-0.5">{sub}</p>}
      </div>
    </Card>
  );
  return href ? <a href={href} className="block">{card}</a> : card;
}

/** Hero card for Total Sales: big total, the component breakdown (the formula), and cash/credit. */
export function TotalSalesBar({
  s, parts, trend, sub, partsLabel,
}: {
  s: Split;
  parts: { label: string; value: number; op?: "+" | "−" }[];
  trend?: number | null;
  sub?: string;
  partsLabel?: string;
}) {
  const partsSum = parts.reduce((acc, p) => (p.op === "−" ? acc - p.value : acc + p.value), 0);
  return (
    <Card className="p-5 mb-6 ring-1 ring-primary/30 bg-gradient-to-br from-primary/[0.04] to-transparent">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Icon name="payments" className="text-[20px] text-primary opacity-70" />
            <span className="text-label-caps uppercase text-on-surface-variant">Total Sales</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular text-primary">{fmtMoney(s.total)}</span>
            {trend !== undefined && <TrendChip value={trend} />}
          </div>
          {sub && <p className="text-body-sm text-on-surface-variant mt-0.5">{sub}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
            {partsLabel && <span className="text-on-surface-variant font-medium">{partsLabel}:</span>}
            {parts.map((p, i) => (
              <span key={p.label} className="inline-flex items-center gap-2">
                {i > 0 && <span className="text-on-surface-variant font-semibold">{p.op ?? "+"}</span>}
                <span className="text-on-surface-variant">
                  {p.label} <span className="tabular font-semibold text-on-surface">{fmtMoney(p.value)}</span>
                </span>
              </span>
            ))}
            <span className="text-on-surface-variant font-semibold">=</span>
            <span className="tabular font-semibold text-on-surface">{fmtMoney(partsSum)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-body-sm lg:w-72 shrink-0">
          <div className="bg-surface-container-low rounded-md px-3 py-2">
            <div className="text-label-caps uppercase text-on-surface-variant">Cash</div>
            <div className="tabular font-semibold text-base">{fmtMoney(s.cash)}</div>
          </div>
          <div className="bg-surface-container-low rounded-md px-3 py-2">
            <div className="text-label-caps uppercase text-on-surface-variant">Credit/Debit</div>
            <div className="tabular font-semibold text-base">{fmtMoney(s.card)}</div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function shortMoney(v: number): string {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

/** Per-day total-sales trend; each bar links to that day's Daily Sales. */
export function SalesTrend({ data }: { data: { label: string; value: number; date: string }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div className="flex items-end justify-between gap-1.5 h-32">
        {data.map((d, i) => (
          <a
            key={i}
            href={`/daily?date=${d.date}`}
            className="flex-1 flex flex-col justify-end h-full group relative"
            title={`${d.date}: ${fmtMoney(d.value)}`}
          >
            <span className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full opacity-0 group-hover:opacity-100 transition-opacity bg-inverse-surface text-inverse-on-surface text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10 pointer-events-none">
              {shortMoney(d.value)}
            </span>
            <span
              className={`w-full rounded-t-sm transition-colors ${i === data.length - 1 ? "bg-primary" : "bg-primary/40 group-hover:bg-primary/70"}`}
              style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </a>
        ))}
      </div>
      <div className="flex justify-between gap-1.5 mt-2">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center text-[11px] text-on-surface-variant">{d.label}</div>
        ))}
      </div>
    </div>
  );
}

/** Simple count card (e.g. Customers) with an optional sub-line. */
export function CountCard({ label, count, sub, icon }: { label: string; count: number; sub?: string; icon: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-label-caps uppercase text-on-surface-variant">{label}</span>
        <Icon name={icon} className="text-[20px] text-primary opacity-70" />
      </div>
      <div className="text-2xl font-bold tabular text-primary">{fmtNumber(count)}</div>
      {sub && <p className="text-body-sm text-on-surface-variant mt-0.5">{sub}</p>}
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
  title, s, extra, className, children, id,
}: {
  title: string; s: Split; extra?: string; className?: string; children: React.ReactNode; id?: string;
}) {
  return (
    <Card id={id} className={`overflow-hidden scroll-mt-20 ${className ?? ""}`}>
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
