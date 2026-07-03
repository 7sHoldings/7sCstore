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

type Lotto = { sales: number; payout: number; net: number };

/**
 * Wide Lottery panel reconciling the POS (system) lottery/payout/net against the
 * employee's manual entry, with the short/over between the two nets.
 */
export function LotteryReconcileCard({
  system, manual, over, trend, entryHref, className,
}: {
  system: Lotto;
  manual: Lotto | null;
  over: number;
  trend?: number | null;
  entryHref?: string;
  className?: string;
}) {
  const signed = (v: number) => (v < 0 ? `-${fmtMoney(-v)}` : fmtMoney(v));
  const Block = ({ title, d, muted }: { title: string; d: Lotto | null; muted?: boolean }) => (
    <div className={`rounded-md p-3 ${muted ? "bg-surface-container-low/60" : "bg-surface-container-low"}`}>
      <div className="text-label-caps uppercase text-on-surface-variant mb-1.5">{title}</div>
      {d ? (
        <div className="space-y-1 text-body-sm">
          <div className="flex justify-between"><span className="text-on-surface-variant">Lottery</span><span className="tabular font-semibold">{fmtMoney(d.sales)}</span></div>
          <div className="flex justify-between"><span className="text-on-surface-variant">Payout</span><span className="tabular font-semibold text-error">{d.payout > 0 ? `-${fmtMoney(d.payout)}` : fmtMoney(0)}</span></div>
          <div className="flex justify-between border-t border-outline-variant/40 pt-1"><span className="text-on-surface-variant">Net</span><span className="tabular font-bold">{fmtMoney(d.net)}</span></div>
        </div>
      ) : (
        <div className="text-body-sm text-on-surface-variant py-3">
          No manual entry yet.{entryHref && <> <a href={entryHref} className="text-primary font-medium underline">Add</a></>}
        </div>
      )}
    </div>
  );
  return (
    <Card className={`p-5 h-full ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-label-caps uppercase text-on-surface-variant">Lottery / Lotto</span>
        <Icon name="confirmation_number" className="text-[20px] text-primary opacity-70" />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular text-primary">{fmtMoney(system.net)}</span>
        {trend !== undefined && <TrendChip value={trend} />}
        <span className="text-body-sm text-on-surface-variant">net (system)</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Block title="System (POS)" d={system} />
        <Block title="Manual (employee)" d={manual} muted />
      </div>
      <div className="mt-2 flex items-center justify-between rounded-md px-3 py-2 bg-surface-container">
        <span className="text-label-caps uppercase text-on-surface-variant">Short / Over</span>
        <span className={`tabular font-bold ${!manual ? "text-on-surface-variant" : over === 0 ? "text-secondary" : "text-error"}`}>
          {manual ? `${over > 0 ? "+" : ""}${signed(over)}` : "—"}
        </span>
      </div>
    </Card>
  );
}

/** Compact strip showing the employee's manual lottery entry + short/over, for the detailed section. */
export function LotteryReconcileStrip({
  manual, over, entryHref,
}: {
  manual: Lotto | null;
  over: number;
  entryHref?: string;
}) {
  const signed = (v: number) => (v < 0 ? `-${fmtMoney(-v)}` : fmtMoney(v));
  return (
    <div className="px-5 py-4 border-t border-outline-variant/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-body-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-label-caps uppercase text-on-surface-variant">Manual (employee)</span>
        {manual ? (
          <span className="text-on-surface-variant">
            Lottery <span className="tabular font-semibold text-on-surface">{fmtMoney(manual.sales)}</span>
            {" · "}Payout <span className="tabular font-semibold text-error">{manual.payout > 0 ? `-${fmtMoney(manual.payout)}` : fmtMoney(0)}</span>
            {" · "}Net <span className="tabular font-bold text-on-surface">{fmtMoney(manual.net)}</span>
          </span>
        ) : (
          <span className="text-on-surface-variant">No manual entry yet.{entryHref && <> <a href={entryHref} className="text-primary font-medium underline">Add</a></>}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-label-caps uppercase text-on-surface-variant">Short / Over</span>
        <span className={`tabular font-bold ${!manual ? "text-on-surface-variant" : over === 0 ? "text-secondary" : "text-error"}`}>
          {manual ? `${over > 0 ? "+" : ""}${signed(over)}` : "—"}
        </span>
      </div>
    </div>
  );
}

/** Owner-side panel showing the employee's manual credit entry (EBT / other credit / payout / house accounts). */
export function ManualCreditPanel({
  data, entryHref, className, receipts = [],
}: {
  data: { ebt: number; otherCredit: number; payouts: { account: string; amount: number }[]; house: { account: string; amount: number }[] } | null;
  entryHref?: string;
  className?: string;
  receipts?: string[];
}) {
  const houseTotal = data ? data.house.reduce((s, h) => s + h.amount, 0) : 0;
  const payoutTotal = data ? data.payouts.reduce((s, h) => s + h.amount, 0) : 0;
  const Cell = ({ label, value, tone }: { label: string; value: number; tone?: "error" }) => (
    <div className="bg-surface-container-low rounded-md px-3 py-2">
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className={`tabular font-semibold text-base ${tone === "error" ? "text-error" : ""}`}>{value < 0 ? `-${fmtMoney(-value)}` : fmtMoney(value)}</div>
    </div>
  );
  const Breakdown = ({ title, items }: { title: string; items: { account: string; amount: number }[] }) => (
    items.length > 0 ? (
      <div className="mt-4">
        <div className="text-label-caps uppercase text-on-surface-variant mb-1.5">{title}</div>
        <div className="flex flex-wrap gap-2">
          {items.map((h) => (
            <span key={h.account} className="inline-flex items-center gap-2 rounded-md bg-surface-container-low px-3 py-1.5 text-body-sm">
              <span className="text-on-surface-variant">{h.account}</span>
              <span className="tabular font-semibold">{fmtMoney(h.amount)}</span>
            </span>
          ))}
        </div>
      </div>
    ) : null
  );
  return (
    <Card className={`overflow-hidden ${className ?? ""}`}>
      <div className="px-5 py-4 border-b border-outline-variant/60 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-on-surface">Employee Manual Entry — Credit &amp; Payouts</h3>
        {entryHref && <a href={entryHref} className="text-primary text-body-sm font-medium underline">{data ? "Edit entry" : "Add entry"}</a>}
      </div>
      {data ? (
        <div className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Cell label="EBT" value={data.ebt} />
            <Cell label="Other Credit Card" value={data.otherCredit} />
            <Cell label="Payout in Cash" value={payoutTotal} tone="error" />
            <Cell label="House Account" value={houseTotal} />
          </div>
          <Breakdown title="Payouts in cash" items={data.payouts} />
          <Breakdown title="House accounts" items={data.house} />
          {receipts.length > 0 && (
            <div className="mt-4">
              <div className="text-label-caps uppercase text-on-surface-variant mb-1.5">Receipts</div>
              <div className="flex flex-wrap gap-2">
                {receipts.map((u, i) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="receipt" className="w-14 h-14 object-cover rounded-md border border-outline-variant/60" /></a>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="px-5 py-8 text-center text-body-sm text-on-surface-variant">
          No manual credit entry yet.{entryHref && <> <a href={entryHref} className="text-primary font-medium underline">Add</a></>}
        </div>
      )}
    </Card>
  );
}

/** Hero card for Total Sales: big total, the component breakdown (the formula), and cash/credit. */
export function TotalSalesBar({
  s, parts, trend, sub, partsLabel, reconcile,
}: {
  s: Split;
  parts: { label: string; value: number; op?: "+" | "−" }[];
  trend?: number | null;
  sub?: string;
  partsLabel?: string;
  /** Optional Short/Over reconciliation. Each part is a signed contribution to the short/over. */
  reconcile?: { parts: { label: string; value: number }[]; shortOver: number };
}) {
  const partsSum = parts.reduce((acc, p) => (p.op === "−" ? acc - p.value : acc + p.value), 0);
  const signed = (v: number) => (v < 0 ? `-${fmtMoney(-v)}` : fmtMoney(v));
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
      {reconcile && (
        <div className="mt-4 pt-4 border-t border-outline-variant/60">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-label-caps uppercase text-on-surface-variant">Short / Over</span>
            <span className={`tabular text-xl font-bold ${reconcile.shortOver === 0 ? "text-secondary" : "text-error"}`}>
              {reconcile.shortOver > 0 ? "+" : ""}{signed(reconcile.shortOver)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
            {reconcile.parts.map((p, i) => (
              <span key={p.label} className="inline-flex items-center gap-1.5">
                {i > 0 && <span className="text-on-surface-variant font-semibold">{p.value >= 0 ? "+" : "−"}</span>}
                <span className="text-on-surface-variant">
                  {p.label} <span className="tabular font-semibold text-on-surface">{p.value < 0 ? fmtMoney(-p.value) : fmtMoney(p.value)}</span>
                </span>
              </span>
            ))}
            <span className="text-on-surface-variant font-semibold">=</span>
            <span className="tabular font-bold text-on-surface">{signed(reconcile.shortOver)}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Whole-dollar amount with thousands separators (e.g. $7,800) — no k-abbreviation. */
function wholeMoney(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

export interface TrendDatum {
  label: string;
  value: number;
  date: string;
  daily?: number;
  fuel?: number;
  lottery?: number;
  tax?: number;
}

const TREND_SEGMENTS: { key: "daily" | "fuel" | "lottery" | "tax"; label: string; cls: string }[] = [
  { key: "daily", label: "Daily", cls: "bg-primary" },
  { key: "fuel", label: "Fuel", cls: "bg-secondary" },
  { key: "lottery", label: "Lottery", cls: "bg-tertiary" },
  { key: "tax", label: "Sales Tax", cls: "bg-on-surface-variant/50" },
];

/**
 * Per-day sales trend; each bar links to that day's Daily Sales. When the data
 * carries a Daily/Fuel/Lottery/Sales-Tax breakdown, bars are stacked and a
 * legend is shown; the full total sits above every bar.
 */
export function SalesTrend({ data }: { data: TrendDatum[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const hasBreakdown = data.some((d) => d.daily != null || d.fuel != null || d.lottery != null || d.tax != null);
  const showLabels = data.length <= 12;

  return (
    <div>
      {hasBreakdown && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
          {TREND_SEGMENTS.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
              <span className={`w-2.5 h-2.5 rounded-sm ${s.cls}`} /> {s.label}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end justify-between gap-2 h-44">
        {data.map((d, i) => {
          const barH = Math.max(2, (Math.max(0, d.value) / max) * 100);
          const pos = TREND_SEGMENTS.map((s) => Math.max(0, (d[s.key] ?? 0) as number));
          const posSum = pos.reduce((a, b) => a + b, 0);
          const isLast = i === data.length - 1;
          return (
            <a
              key={i}
              href={`/daily?date=${d.date}`}
              className="flex-1 flex flex-col items-center justify-end h-full group"
              title={`${d.date}: ${fmtMoney(d.value)}`}
            >
              {showLabels && (
                <span className="text-[10px] sm:text-[11px] font-semibold text-on-surface mb-1 tabular whitespace-nowrap">
                  {wholeMoney(d.value)}
                </span>
              )}
              <span
                className={`w-full rounded-t-sm overflow-hidden flex flex-col-reverse ring-1 ring-black/5 ${hasBreakdown ? "" : isLast ? "bg-primary" : "bg-primary/40 group-hover:bg-primary/70"}`}
                style={{ height: `${barH}%` }}
              >
                {hasBreakdown && posSum > 0 && TREND_SEGMENTS.map((s, si) => {
                  const frac = pos[si] / posSum;
                  if (frac <= 0) return null;
                  return (
                    <span
                      key={s.key}
                      className={`${s.cls} ${isLast ? "" : "opacity-90 group-hover:opacity-100"} transition-opacity`}
                      style={{ height: `${frac * 100}%` }}
                      title={`${s.label}: ${fmtMoney((d[s.key] ?? 0) as number)}`}
                    />
                  );
                })}
              </span>
            </a>
          );
        })}
      </div>
      <div className="flex justify-between gap-2 mt-2">
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
