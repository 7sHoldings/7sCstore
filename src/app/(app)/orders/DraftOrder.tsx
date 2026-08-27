"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Icon, Banner } from "@/components/ui";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/format";
import { setLineCases, removeLine, createOrderNow, markPlaced, deleteDraft, setOrderVersion } from "./actions";
import WhyThisMany from "./WhyThisMany";
import { ORDER_VERSIONS } from "@/lib/vendors/orderVersions";

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
  casesFull: number | null;
  casesBalanced: number | null;
  casesLean: number | null;
  spikeMean?: number | null;
}

export default function DraftOrder({
  purchaseOrderId, createdAt, refreshedAt, coverWeeks, canEdit, totalCost, measured, lines,
  typicalOrder, pastOrderCount, version, versionTotals,
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
  version: string;
  /** Cost of each version, so all three can be compared before choosing. */
  versionTotals: Record<string, { lines: number; cost: number }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [basis, setBasis] = useState("");
  const [flag, setFlag] = useState("");
  const [sort, setSort] = useState("demand");
  // Local echo of edits so the row doesn't snap back while the server saves.
  const [edits, setEdits] = useState<Record<string, number>>({});

  const departments = useMemo(
    () => [...new Set(lines.map((l) => l.department).filter((d): d is string => !!d))].sort(),
    [lines]
  );

  // A forecast line is either measured from sales or guessed from past orders,
  // and the owner reviews those two very differently — the guesses are the ones
  // worth a second look, so they have to be separable.
  const fromSales = (l: DraftLine) =>
    l.basis === "measured" || l.basis === "imported" || l.basis === "velocity";

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = lines.filter((l) => {
      if (dept && l.department !== dept) return false;
      if (s && !(l.description.toLowerCase().includes(s) || l.sku.includes(s) || l.upcNorm.includes(s)))
        return false;
      if (basis === "sales" && !fromSales(l)) return false;
      if (basis === "guess" && fromSales(l)) return false;
      const cases = edits[l.id] ?? l.cases;
      if (flag === "ordering" && cases <= 0) return false;
      if (flag === "dropped" && cases > 0) return false;
      if (flag === "edited" && !(l.edited || edits[l.id] !== undefined)) return false;
      if (flag === "trimmed" && !l.cappedByHistory) return false;
      if (flag === "noshelf" && (l.receivedUnits ?? 0) > 0) return false;
      return true;
    });

    const cost = (l: DraftLine) => (edits[l.id] ?? l.cases) * l.caseCost;
    const byName = (a: DraftLine, b: DraftLine) => a.description.localeCompare(b.description);
    const sorted = [...rows];
    if (sort === "cost") sorted.sort((a, b) => cost(b) - cost(a) || byName(a, b));
    else if (sort === "cheap") sorted.sort((a, b) => cost(a) - cost(b) || byName(a, b));
    else if (sort === "name") sorted.sort(byName);
    else if (sort === "dept")
      sorted.sort((a, b) => (a.department ?? "~").localeCompare(b.department ?? "~") || byName(a, b));
    else sorted.sort((a, b) => b.weeklyUnits - a.weeklyUnits || byName(a, b));
    return sorted;
  }, [lines, q, dept, basis, flag, sort, edits]);

  // What the rows on screen come to. Filtering to one department and seeing it
  // costs $2,100 of a $9,288 order is the question this screen gets asked most.
  const shownCost = visible.reduce((sum, l) => sum + (edits[l.id] ?? l.cases) * l.caseCost, 0);
  const shownCases = visible.reduce((sum, l) => sum + (edits[l.id] ?? l.cases), 0);
  const filtered = Boolean(q || dept || basis || flag);
  function clearFilters() {
    setQ(""); setDept(""); setBasis(""); setFlag(""); setSort("demand");
  }

  // Counts on the dropdown options, so the owner can see there are 12 guessed
  // lines without having to select the filter to find out.
  const deptCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) if (l.department) m.set(l.department, (m.get(l.department) ?? 0) + 1);
    return m;
  }, [lines]);

  const counts = useMemo(() => {
    const c = { sales: 0, guess: 0, ordering: 0, dropped: 0, edited: 0, trimmed: 0, noshelf: 0 };
    for (const l of lines) {
      if (fromSales(l)) c.sales++; else c.guess++;
      if ((edits[l.id] ?? l.cases) > 0) c.ordering++; else c.dropped++;
      if (l.edited || edits[l.id] !== undefined) c.edited++;
      if (l.cappedByHistory) c.trimmed++;
      if ((l.receivedUnits ?? 0) <= 0) c.noshelf++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, edits]);

  const activeVersion = ORDER_VERSIONS.find((v) => v.key === version) ?? ORDER_VERSIONS[0];
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

      {/* Three sizes of the same order */}
      {canEdit && (
        <Card className="p-4 mb-4">
          <div className="flex items-center gap-2 mb-3 font-semibold text-on-surface text-body-sm">
            <Icon name="tune" className="text-[20px] text-primary" />
            How much of it to buy
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {ORDER_VERSIONS.map((v) => {
              const t = versionTotals[v.key] ?? { lines: 0, cost: 0 };
              const active = version === v.key;
              return (
                <form key={v.key} action={setOrderVersion}>
                  <input type="hidden" name="version" value={v.key} readOnly />
                  <button
                    type="submit"
                    aria-pressed={active}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      active
                        ? "border-primary bg-primary/[0.06]"
                        : "border-outline-variant/60 hover:bg-surface-container-low"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-on-surface">{v.label}</span>
                      {active && <Badge tone="info">chosen</Badge>}
                    </div>
                    <div className="tabular text-lg font-bold text-primary mt-0.5">{fmtMoney(t.cost)}</div>
                    <div className="text-body-sm text-on-surface-variant">
                      {fmtNumber(t.lines)} lines
                      {typicalOrder ? ` · ${Math.round((t.cost / typicalOrder) * 100)}% of usual` : ""}
                    </div>
                    <div className="text-body-sm text-on-surface-variant mt-1">{v.blurb}</div>
                  </button>
                </form>
              );
            })}
          </div>
          <p className="text-body-sm text-on-surface-variant mt-2">
            The same forecast bought for a different slice of the week, so lines stay
            comparable: an item needing 4 cases for a full week becomes 3, then 2. Quantities
            you set by hand aren&apos;t touched when you switch.
          </p>
        </Card>
      )}

      {/* Filters */}
      <div className="mb-4 bg-surface-container-low border border-outline-variant/60 rounded-lg p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search product, SKU or UPC…"
            className="ft-input py-1.5 text-body-sm flex-1 min-w-[12rem]"
          />
          <select
            value={dept} onChange={(e) => setDept(e.target.value)}
            aria-label="Department"
            className="ft-input py-1.5 text-body-sm min-w-[10rem]"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d} ({deptCounts.get(d) ?? 0})
              </option>
            ))}
          </select>
          <select
            value={basis} onChange={(e) => setBasis(e.target.value)}
            aria-label="Where the quantity came from"
            className="ft-input py-1.5 text-body-sm min-w-[11rem]"
          >
            <option value="">Any source</option>
            <option value="sales">From sales ({counts.sales})</option>
            <option value="guess">From past orders ({counts.guess})</option>
          </select>
          <select
            value={flag} onChange={(e) => setFlag(e.target.value)}
            aria-label="Show which lines"
            className="ft-input py-1.5 text-body-sm min-w-[11rem]"
          >
            <option value="">All lines</option>
            <option value="ordering">In this order ({counts.ordering})</option>
            <option value="dropped">Dropped to zero ({counts.dropped})</option>
            <option value="edited">Changed by you ({counts.edited})</option>
            <option value="trimmed">Trimmed to usual ({counts.trimmed})</option>
            <option value="noshelf">Shelf unknown ({counts.noshelf})</option>
          </select>
          <select
            value={sort} onChange={(e) => setSort(e.target.value)}
            aria-label="Sort"
            className="ft-input py-1.5 text-body-sm min-w-[11rem]"
          >
            <option value="demand">Fastest selling first</option>
            <option value="cost">Most expensive first</option>
            <option value="cheap">Cheapest first</option>
            <option value="name">Product A–Z</option>
            <option value="dept">Department A–Z</option>
          </select>
          {filtered && (
            <button type="button" onClick={clearFilters} className="ft-btn-ghost py-1.5 text-body-sm">
              <Icon name="close" className="text-[16px]" />
              Clear
            </button>
          )}
        </div>
        <div className="mt-2 text-body-sm text-on-surface-variant tabular">
          {fmtNumber(visible.length)} of {fmtNumber(lines.length)} lines ·{" "}
          {fmtNumber(shownCases)} case{shownCases === 1 ? "" : "s"} ·{" "}
          <strong className="text-on-surface">{fmtMoney(shownCost)}</strong>
          {filtered && liveTotal > 0 && ` of ${fmtMoney(liveTotal)}`}
          {pending ? " · saving…" : ""}
        </div>
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
                <th className="px-3 py-3 w-10"><span className="sr-only">Why</span></th>
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
                        ) : l.basis === "imported" ? (
                          <Badge tone="success">from your export</Badge>
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
                    <td className="px-3 py-3 text-center">
                      <WhyThisMany
                        facts={{
                          description: l.description,
                          cases,
                          suggestedCases: l.suggestedCases,
                          unitsPerCase: l.unitsPerCase,
                          caseCost: l.caseCost,
                          weeklyUnits: l.weeklyUnits,
                          weeklySeries: l.weeklySeries ?? [],
                          weeksWithSales: l.weeksWithSales,
                          spikeMean: l.spikeMean,
                          onHand: l.onHand,
                          receivedUnits: l.receivedUnits,
                          soldInHistory: l.soldInHistory,
                          typicalCases: l.typicalCases,
                          cappedByHistory: l.cappedByHistory,
                          edited: l.edited || edits[l.id] !== undefined,
                          basis: l.basis,
                          soldInWindow: l.soldInWindow,
                          windowDays: l.windowDays,
                          coverWeeks,
                          versionLabel: activeVersion.label,
                          versionMultiplier: activeVersion.coverMultiplier,
                        }}
                      />
                    </td>
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
