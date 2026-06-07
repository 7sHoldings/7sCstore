"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createSale } from "./actions";
import { Icon } from "@/components/ui";
import { catLabel, gradeLabel, paymentLabel } from "@/lib/format";

const CATEGORIES = ["FUEL", "STORE", "LOTTERY", "TOBACCO", "FOOD_DRINK", "OTHER"];
const GRADES = ["REGULAR", "MID", "PREMIUM", "DIESEL"];
const PAYMENTS = ["CASH", "CARD", "OTHER"];

export default function SaleForm({ defaultDate }: { defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("FUEL");
  const [state, action, pending] = useActionState(createSale, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setCategory("FUEL");
      setOpen(false);
    }
  }, [state?.ok]);

  if (!open) {
    return (
      <button className="ft-btn-primary" onClick={() => setOpen(true)}>
        <Icon name="add" className="text-[18px]" /> New Sale
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center no-print">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
      <div className="relative bg-surface-container-lowest rounded-t-xl sm:rounded-xl shadow-floating w-full sm:max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="sticky top-0 bg-surface-container-lowest border-b border-outline-variant/60 px-5 py-4 flex items-center justify-between">
          <h3 className="font-semibold text-on-surface text-headline-sm">Record a Sale</h3>
          <button onClick={() => setOpen(false)} className="ft-btn-ghost p-1.5 rounded-full">
            <Icon name="close" />
          </button>
        </div>

        <form ref={formRef} action={action} className="p-5 space-y-4">
          {/* Category selector */}
          <div>
            <label className="ft-label">Category</label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`px-2 py-2 rounded-md text-body-sm font-medium border transition-colors ${
                    category === c
                      ? "bg-primary text-on-primary border-primary"
                      : "bg-surface-container-low border-outline-variant text-on-surface-variant"
                  }`}
                >
                  {catLabel(c)}
                </button>
              ))}
            </div>
            <input type="hidden" name="category" value={category} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ft-label" htmlFor="date">Date</label>
              <input id="date" name="date" type="date" defaultValue={defaultDate} className="ft-input" required />
            </div>
            <div>
              <label className="ft-label" htmlFor="paymentType">Payment</label>
              <select id="paymentType" name="paymentType" className="ft-input" defaultValue="CARD">
                {PAYMENTS.map((p) => (
                  <option key={p} value={p}>{paymentLabel(p)}</option>
                ))}
              </select>
            </div>
          </div>

          {category === "FUEL" ? (
            <div className="space-y-3 bg-surface-container-low rounded-md p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ft-label" htmlFor="grade">Grade</label>
                  <select id="grade" name="grade" className="ft-input" defaultValue="REGULAR">
                    {GRADES.map((g) => (
                      <option key={g} value={g}>{gradeLabel(g)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="ft-label" htmlFor="gallons">Gallons</label>
                  <input id="gallons" name="gallons" type="number" step="0.001" min="0" className="ft-input" placeholder="0.000" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ft-label" htmlFor="pricePerGallon">Price / gal</label>
                  <input id="pricePerGallon" name="pricePerGallon" type="number" step="0.0001" min="0" className="ft-input" placeholder="0.0000" />
                </div>
                <div>
                  <label className="ft-label" htmlFor="costPerGallon">Cost / gal (optional)</label>
                  <input id="costPerGallon" name="costPerGallon" type="number" step="0.0001" min="0" className="ft-input" placeholder="auto" />
                </div>
              </div>
              <div>
                <label className="ft-label" htmlFor="taxPerGallon">Fuel tax / gal</label>
                <input id="taxPerGallon" name="taxPerGallon" type="number" step="0.0001" min="0" defaultValue="0.184" className="ft-input" />
              </div>
              <p className="text-body-sm text-on-surface-variant">
                Total is computed from gallons × price. Leave cost blank to use your latest delivery cost.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="ft-label" htmlFor="amount">
                  {category === "LOTTERY" ? "Commission earned" : "Amount (ex-tax)"}
                </label>
                <input id="amount" name="amount" type="number" step="0.01" min="0" className="ft-input" placeholder="0.00" />
              </div>
              <div>
                <label className="ft-label" htmlFor="taxCollected">Sales tax collected</label>
                <input id="taxCollected" name="taxCollected" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ft-label" htmlFor="refund">Refunds / voids</label>
              <input id="refund" name="refund" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" />
            </div>
            <div>
              <label className="ft-label" htmlFor="note">Note (optional)</label>
              <input id="note" name="note" type="text" className="ft-input" placeholder="e.g. Pump 3" />
            </div>
          </div>

          {category === "LOTTERY" && (
            <p className="text-body-sm text-on-surface-variant bg-tertiary-container/40 rounded-md px-3 py-2">
              <Icon name="info" className="text-[16px] align-middle mr-1" />
              Record only the commission you earn — ticket face value and payouts are pass-through, not revenue.
            </p>
          )}

          {state?.error && (
            <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
              <Icon name="error" className="text-[18px]" /> {state.error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">
              {pending ? "Saving…" : "Save sale"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
