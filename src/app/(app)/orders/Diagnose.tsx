"use client";

import { useState } from "react";
import { Card, Icon, Badge } from "@/components/ui";
import { fmtNumber } from "@/lib/format";
import { diagnoseDemand, type DemandDiagnosis } from "./actions";

/**
 * Explains why sales are or aren't driving the order.
 *
 * The forecast joins vendor products to POS sales on a normalised scan code.
 * When that join finds nothing the order quietly falls back to past orders and
 * comes out identical every week, with no indication why. This reports the join
 * itself, so the cause is a fact rather than a guess.
 */
export default function Diagnose() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<DemandDiagnosis | null>(null);

  async function run() {
    setBusy(true);
    try {
      setD(await diagnoseDemand());
    } finally {
      setBusy(false);
    }
  }

  const verdict = !d
    ? null
    : d.error
    ? { tone: "error" as const, text: d.error }
    : d.demandRows === 0
    ? { tone: "error" as const, text: "No sales have been stored at all. The pull has never succeeded." }
    : d.looksCumulative
    ? { tone: "error" as const, text: "Every week carries the same figure, so the POS reported a running total rather than weekly sales. It is being refused — that is why quantities come from past orders." }
    : d.matched === 0
    ? { tone: "error" as const, text: "Sales were stored, but not one of them matches a product you buy from GSC. The scan codes on the two sides are not the same, so the forecast has nothing to work with." }
    : d.matched < d.catalogue * 0.2
    ? { tone: "warn" as const, text: `Only ${fmtNumber(d.matched)} of ${fmtNumber(d.catalogue)} GSC products have sales against them, so most lines still fall back to past orders.` }
    : { tone: "ok" as const, text: `${fmtNumber(d.matched)} of ${fmtNumber(d.catalogue)} GSC products have sales — the forecast can use them.` };

  return (
    <Card className="mb-6 overflow-hidden">
      <button
        onClick={() => { setOpen((v) => !v); if (!d && !open) run(); }}
        className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-surface-container-low/50 text-left"
      >
        <span className="flex items-center gap-2 font-semibold text-on-surface">
          <Icon name="troubleshoot" className="text-[20px] text-primary" />
          Why isn&apos;t the order using sales?
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} className="text-on-surface-variant" />
      </button>

      {open && (
        <div className="border-t border-outline-variant/60 p-4 space-y-3">
          {busy && <p className="text-body-sm text-on-surface-variant">Checking…</p>}

          {verdict && (
            <p
              className={`text-body-sm font-medium ${
                verdict.tone === "ok" ? "text-secondary" : verdict.tone === "warn" ? "text-tertiary" : "text-error"
              }`}
            >
              {verdict.text}
            </p>
          )}

          {d && !d.error && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-body-sm">
                <Fact label="Sales rows" value={fmtNumber(d.demandRows)} />
                <Fact label="Weekly periods" value={fmtNumber(d.weeklyPeriods)} />
                <Fact label="Products with sales" value={fmtNumber(d.soldProducts)} />
                <Fact
                  label="Matched to GSC"
                  value={`${fmtNumber(d.matched)} / ${fmtNumber(d.catalogue)}`}
                  bad={d.matched === 0}
                />
              </div>

              {d.oldest && (
                <p className="text-body-sm text-on-surface-variant">
                  Sales stored from {d.oldest} to {d.newest}.
                  {d.weeklyPeriods < 3 && (
                    <> Only {d.weeklyPeriods} weekly period{d.weeklyPeriods === 1 ? "" : "s"} —
                    the median needs at least three to mean anything.</>
                  )}
                </p>
              )}

              {d.matched === 0 && d.sampleUnmatchedCatalogue.length > 0 && (
                <div className="text-body-sm">
                  <p className="text-on-surface-variant mb-1">
                    Scan codes that should match but don&apos;t — if these look like the same
                    products written differently, that is the bug:
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3 mt-2">
                    <div>
                      <div className="text-label-caps uppercase text-on-surface-variant mb-1">From GSC orders</div>
                      <ul className="font-mono text-body-sm space-y-0.5">
                        {d.sampleUnmatchedCatalogue.map((r) => (
                          <li key={r.upcNorm} className="truncate">
                            {r.upcNorm} <span className="opacity-60">{r.description}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-label-caps uppercase text-on-surface-variant mb-1">From POS sales</div>
                      <ul className="font-mono text-body-sm space-y-0.5">
                        {d.sampleUnmatchedSales.map((u) => <li key={u}>{u}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <button onClick={run} disabled={busy} className="ft-btn-secondary py-1.5">
            <Icon name="refresh" className="text-[18px]" /> Check again
          </button>
        </div>
      )}
    </Card>
  );
}

function Fact({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="bg-surface-container-low rounded-md px-3 py-2">
      <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
      <div className={`tabular font-bold ${bad ? "text-error" : "text-on-surface"}`}>{value}</div>
    </div>
  );
}
