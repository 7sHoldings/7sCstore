"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui";
import { fmtMoney, fmtNumber } from "@/lib/format";

export interface WhyFacts {
  description: string;
  cases: number;
  suggestedCases: number;
  unitsPerCase: number;
  caseCost: number;
  weeklyUnits: number;
  weeklySeries: number[];
  weeksWithSales: number | null;
  spikeMean?: number | null;
  onHand: number | null;
  receivedUnits: number | null;
  soldInHistory: number | null;
  typicalCases: number | null;
  cappedByHistory: boolean;
  edited: boolean;
  basis: string;
  coverWeeks: number;
  versionLabel: string;
  versionMultiplier: number;
}

/**
 * The reasoning behind one line's quantity.
 *
 * Rendered into a portal with fixed positioning because the order table scrolls
 * sideways — a popover inside that container would be clipped at its edge.
 * Opens on hover for a quick look and on click for a tap or a keyboard, so it
 * works the same on the shop floor as at a desk.
 */
export default function WhyThisMany(props: { facts: WhyFacts }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = 320;
    // Keep the card on screen when the row sits near the right edge.
    const left = Math.min(Math.max(8, r.left - width - 12), window.innerWidth - width - 8);
    setPos({ top: Math.min(r.top, window.innerHeight - 340), left });
  }

  const f = props.facts;
  const needForCover = f.weeklyUnits * f.coverWeeks * f.versionMultiplier;
  const shelf = f.onHand ?? 0;
  const shortfall = Math.max(0, needForCover - shelf);
  const shelfKnown = (f.receivedUnits ?? 0) > 0;

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={`Why ${f.cases} cases of ${f.description}?`}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        onFocus={show}
        onBlur={() => setPos(null)}
        onClick={() => (pos ? setPos(null) : show())}
        className="ft-btn-ghost p-1 rounded-full text-on-surface-variant hover:text-primary"
      >
        <Icon name="help" className="text-[17px]" />
      </button>

      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: 320, zIndex: 90 }}
            className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-floating p-4 text-body-sm"
          >
            <div className="font-semibold text-on-surface mb-1">
              Why {fmtNumber(f.cases)} case{f.cases === 1 ? "" : "s"}?
            </div>
            <div className="text-on-surface-variant mb-3 truncate">{f.description}</div>

            {/* What it sells */}
            <Row label="Sold each week">
              {f.weeklySeries.length > 0 ? (
                <span className="font-mono">{f.weeklySeries.map((n) => fmtNumber(n)).join(" · ")}</span>
              ) : (
                <span className="opacity-60">no sales pulled</span>
              )}
            </Row>
            {f.weeklySeries.length > 0 && (
              <Row label="Typical week">
                {fmtNumber(f.weeklyUnits)} units
                {f.spikeMean != null && f.spikeMean !== f.weeklyUnits && (
                  <span className="opacity-60"> (average {fmtNumber(f.spikeMean)})</span>
                )}
              </Row>
            )}
            {f.weeksWithSales != null && f.weeklySeries.length > 0 && (
              <Row label="Weeks with sales">
                {f.weeksWithSales} of {f.weeklySeries.length}
              </Row>
            )}

            {/* What's already here */}
            <div className="border-t border-outline-variant/50 my-2" />
            <Row label="On the shelf">
              {shelfKnown ? (
                <>
                  {fmtNumber(shelf)} units
                  <span className="block opacity-60">
                    {fmtNumber(f.receivedUnits ?? 0)} delivered − {fmtNumber(f.soldInHistory ?? 0)} sold
                  </span>
                </>
              ) : (
                <span className="opacity-60">unknown — no dated delivery</span>
              )}
            </Row>

            {/* The arithmetic */}
            <div className="border-t border-outline-variant/50 my-2" />
            <Row label={`Need for ${fmtNumber(f.coverWeeks * f.versionMultiplier)} week`}>
              {fmtNumber(Math.round(needForCover * 10) / 10)} units
            </Row>
            {shelfKnown && <Row label="Less what's here">−{fmtNumber(shelf)}</Row>}
            <Row label="Short by">{fmtNumber(Math.round(shortfall * 10) / 10)} units</Row>
            <Row label="Case size">{fmtNumber(f.unitsPerCase)} per case</Row>

            <div className="border-t border-outline-variant/50 my-2" />
            <div className="flex items-baseline justify-between gap-2 font-semibold text-on-surface">
              <span>{f.versionLabel} order</span>
              <span className="tabular">
                {fmtNumber(f.suggestedCases)} case{f.suggestedCases === 1 ? "" : "s"} ·{" "}
                {fmtMoney(f.suggestedCases * f.caseCost)}
              </span>
            </div>

            {/* Anything that changed the number */}
            {f.cappedByHistory && f.typicalCases != null && (
              <p className="mt-2 text-tertiary">
                Trimmed to stay near your usual {fmtNumber(f.typicalCases)} case
                {f.typicalCases === 1 ? "" : "s"} per order.
              </p>
            )}
            {f.basis === "order-history" && (
              <p className="mt-2 text-on-surface-variant">
                No sales history for this one — the quantity comes from what you have
                bought before.
              </p>
            )}
            {f.edited && (
              <p className="mt-2 text-primary">
                You set this to {fmtNumber(f.cases)}. Daily updates leave it alone.
              </p>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-on-surface-variant shrink-0">{label}</span>
      <span className="text-on-surface text-right tabular">{children}</span>
    </div>
  );
}
