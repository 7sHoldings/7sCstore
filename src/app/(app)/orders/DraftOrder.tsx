"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Icon, Banner } from "@/components/ui";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/format";
import { setLineCases, removeLine, createOrderNow, markPlaced, deleteDraft } from "./actions";

export interface DraftLine {
  id: string;
  sku: string;
  upcNorm: string;
  description: string;
  department: string | null;
  unitsPerCase: number;
  caseCost: number;
  weeklyUnits: number;
  suggestedCases: number;
  cases: number;
  basis: string;
  soldInWindow: number | null;
  windowDays: number | null;
  edited: boolean;
  weeklySeries: number[];
  weeksWithSales: number | null;
  typicalCases: number | null;
  cappedByHistory: boolean;
  receivedUnits: number | null;
  soldInHistory: number | null;
  onHand: number | null;
}

export default function DraftOrder({
  purchaseOrderId, createdAt, refreshedAt, coverWeeks, canEdit, totalCost, measured, lines,
  typicalOrder, pastOrderCount,
}: {
  purchaseOrderId: string;
  createdAt: string;
  refreshedAt: string;
  coverWeeks: number;
  canEdit: boolean;
  totalCost: number;
  measured: number;
  lines: DraftLine[];
  /** Median cost of recent GSC orders, as a yardstick. */
  typicalOrder: number | null;
  pastOrderCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  // Local echo of edits so the row doesn't snap back while the server saves.
  const [edits, setEdits] = useState<Record<string, number>>({});

  const departments = useMemo(
    () => [...new Set(lines.map((l) => l.department).filter((d): d is string => !!d))].sort(),
    [lines]
  );

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return lines.filter(
      (l) =>
        (!dept || l.department === dept) &&
        (!s || l.description.toLowerCase().includes(s) || l.sku.includes(s) || l.upcNorm.includes(s))
    );
  }, [lines, q, dept]);

  const casesOf = (l: DraftLine) => edits[l.id] ?? l.cases;
  const editedCount = lines.filter((l) => l.edited || edits[l.id] !== undefined).length;
  const liveTotal = lines.reduce((s, l) => s + casesOf(l) * l.caseCost, 0);
  const liveLines = lines.filter((l) => casesOf(l) > 0).length;

  function save(l: DraftLine, next: number) {
    setEdits((p) => ({ ...p, [l.id]: next }));
    startTransition(async () => {
      const res = await setLineCases({ lineId: l.id, cases: next });
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function drop(l: DraftLine) {
    startTransition(async () => {
      const res = await removeLine({ lineId: l.id });
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div>
      {error && <Banner tone="error" icon="error">{error}</Banner>}

      {/* Summary + actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile label="Lines to Order" value={fmtNumber(liveLines)} hint={`of ${fmtNumber(lines.length)} suggested`} />
        <Tile label="Estimated Cost" value={fmtMoney(liveTotal)} />
        <Tile
          label="vs Your Usual Order"
          value={typicalOrder ? `${Math.round((liveTotal / typicalOrder) * 100)}%` : "—"}
          hint={
            typicalOrder
              ? `usually ${fmtMoney(typicalOrder)} over ${pastOrderCount} orders`
              : "upload more orders to compare"
          }
          accent={typicalOrder && liveTotal > typicalOrder * 1.25 ? "warning" : undefined}
        />
        <Tile
          label="Forecast From Sales"
          value={`${fmtNumber(measured)} / ${fmtNumber(lines.length)}`}
          hint={measured < lines.length ? "rest from past orders" : "every line"}
        />
      </div>

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <span className="text-body-sm text-on-surface-variant">
            Built {fmtDate(createdAt)}
            {refreshedAt.slice(0, 10) !== createdAt.slice(0, 10) && ` · updated ${fmtDate(refreshedAt)}`}
            {editedCount > 0 && ` · ${editedCount} line${editedCount === 1 ? "" : "s"} you set by hand`}
          </span>

          {canEdit && (
            <>
              <form action={createOrderNow} className="flex items-end gap-2">
                <div>
                  <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="cw">
                    Weeks of cover
                  </label>
                  <input
                    id="cw" name="coverWeeks" type="number" min="1" max="8" step="0.5"
                    defaultValue={coverWeeks}
                    className="ft-input py-1.5 text-body-sm w-24 tabular"
                  />
                </div>
                <button type="submit" className="ft-btn-secondary py-1.5">
                  <Icon name="refresh" className="text-[18px]" /> Rebuild at this cover
                </button>
              </form>

              <a href={`/api/orders/export?id=${purchaseOrderId}`} className="ft-btn-secondary py-1.5">
                <Icon name="download" className="text-[18px]" /> Export CSV
              </a>

              <form action={markPlaced}>
                <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} readOnly />
                <button type="submit" className="ft-btn-primary py-1.5">
                  <Icon name="check" className="text-[18px]" /> Mark as ordered
                </button>
              </form>

              <form action={deleteDraft} className="ml-auto">
                <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} readOnly />
                <button type="submit" className="ft-btn-ghost py-1.5 text-error">
                  <Icon name="delete" className="text-[18px]" /> Delete this draft
                </button>
              </form>
            </>
          )}
        </div>
        <p className="text-body-sm text-on-surface-variant mt-2">
          Each line uses the <strong>median</strong> week, not the average, so one customer
          clearing the shelf once doesn&apos;t become a standing order. Quantities are also
          held near what you normally buy for that product. Slow movers are left off — if it
          sells one every couple of weeks, what&apos;s on the shelf already covers it.
          What is already on the shelf — delivered but not yet sold — is subtracted before
          anything is ordered, so stock you already have is not bought twice. Change any
          number below; it saves as you type, and a daily update never overwrites a quantity
          you set yourself.
        </p>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4 bg-surface-container-low border border-outline-variant/60 rounded-lg p-3">
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search product, SKU or UPC…"
          className="ft-input py-1.5 text-body-sm flex-1 min-w-[12rem]"
        />
        <select
          value={dept} onChange={(e) => setDept(e.target.value)}
          className="ft-input py-1.5 text-body-sm min-w-[10rem]"
        >
          <option value="">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="text-body-sm text-on-surface-variant tabular ml-auto self-center">
          {fmtNumber(visible.length)} shown{pending ? " · saving…" : ""}
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">
          Suggested order
        </div>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                <th className="px-3 py-3">SKU</th>
                <th className="px-3 py-3">Product</th>
                <th className="px-3 py-3 text-right">Sold each week</th>
                <th className="px-3 py-3 text-right">Median / wk</th>
                <th className="px-3 py-3 text-right">On shelf</th>
                <th className="px-3 py-3 text-right">Pack</th>
                <th className="px-3 py-3 text-right">Suggested</th>
                <th className="px-3 py-3 text-right">Cases</th>
                <th className="px-3 py-3 text-right">Cost</th>
                {canEdit && <th className="px-3 py-3 w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/40">
              {visible.map((l) => {
                const cases = casesOf(l);
                const changed = cases !== l.suggestedCases;
                return (
                  <tr key={l.id} className={`hover:bg-surface-container-low/50 ${cases === 0 ? "opacity-50" : ""}`}>
                    <td className="px-3 py-3 tabular text-on-surface-variant">{l.sku}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-on-surface">{l.description}</div>
                      <div className="text-body-sm text-on-surface-variant">
                        {l.department ?? "—"}
                        {l.basis === "measured" ? (
                          <Badge tone="success">from sales</Badge>
                        ) : l.basis === "velocity" ? (
                          <Badge tone="success">measured</Badge>
                        ) : (
                          <Badge tone="neutral">from past orders</Badge>
                        )}
                        {(l.edited || edits[l.id] !== undefined) && <Badge tone="info">yours</Badge>}
                        {l.cappedByHistory && <Badge tone="warning">trimmed to your usual</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular text-on-surface-variant whitespace-nowrap">
                      {l.weeklySeries && l.weeklySeries.length > 0 ? (
                        <>
                          <span className="font-mono text-body-sm">
                            {l.weeklySeries.map((n) => fmtNumber(n)).join(" · ")}
                          </span>
                          <span className="block text-body-sm opacity-70">
                            per week{l.weeksWithSales != null && ` · sold in ${l.weeksWithSales}/${l.weeklySeries.length}`}
                          </span>
                        </>
                      ) : l.soldInWindow != null && l.windowDays != null ? (
                        <>
                          {fmtNumber(l.soldInWindow)}
                          <span className="block text-body-sm opacity-70">in {l.windowDays}d</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular font-medium">{fmtNumber(l.weeklyUnits)}</td>
                    <td className="px-3 py-3 text-right tabular text-on-surface-variant whitespace-nowrap">
                      {l.onHand == null || l.receivedUnits == null || l.receivedUnits === 0 ? (
                        <span className="opacity-50">—</span>
                      ) : (
                        <>
                          {fmtNumber(l.onHand)}
                          <span className="block text-body-sm opacity-70">
                            {fmtNumber(l.receivedUnits)} in · {fmtNumber(l.soldInHistory ?? 0)} sold
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular text-on-surface-variant">{fmtNumber(l.unitsPerCase)}</td>
                    <td className="px-3 py-3 text-right tabular text-on-surface-variant">{fmtNumber(l.suggestedCases)}</td>
                    <td className="px-3 py-3 text-right">
                      {canEdit ? (
                        <input
                          type="number" min="0" max="999" step="1"
                          value={cases}
                          onChange={(e) => save(l, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                          className={`ft-input py-1 text-body-sm w-20 text-right tabular ${changed ? "border-primary" : ""}`}
                        />
                      ) : (
                        <span className="tabular">{fmtNumber(cases)}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular font-semibold">{fmtMoney(cases * l.caseCost)}</td>
                    {canEdit && (
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => drop(l)}
                          aria-label={`Remove ${l.description}`}
                          className="ft-btn-ghost p-1.5 rounded-full"
                        >
                          <Icon name="close" className="text-[18px]" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Tile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: "warning" }) {
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
      <div className={`tabular text-lg font-bold mt-1 ${accent === "warning" ? "text-tertiary" : "text-on-surface"}`}>{value}</div>
      {hint && <div className="text-body-sm text-on-surface-variant mt-0.5 truncate">{hint}</div>}
    </Card>
  );
}
