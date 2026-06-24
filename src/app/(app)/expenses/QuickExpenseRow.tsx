"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createExpense } from "./actions";
import { Icon } from "@/components/ui";
import { expenseCatLabel, paymentLabel } from "@/lib/format";
import { fixedSubOptionsFor, vendorSuggestionsFor } from "@/lib/expenseOptions";

const CATEGORIES = ["STORE_OPERATING_EXPENSES", "INVENTORY_PURCHASE"];
const PAYMENTS = ["CASH", "CARD", "OTHER"];

// Always-visible inline entry row — fill left to right and hit Add (or Enter)
// to save. Date + Category stay put so you can log many rows quickly; the
// amount field re-focuses after each save.
export default function QuickExpenseRow({ defaultDate }: { defaultDate: string }) {
  const [state, action, pending] = useActionState(createExpense, {});
  const [date, setDate] = useState(defaultDate);
  const [category, setCategory] = useState("STORE_OPERATING_EXPENSES");
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const fixedSubOptions = fixedSubOptionsFor(category);
  const vendorSuggestions = vendorSuggestionsFor(category);
  const isInventory = category === "INVENTORY_PURCHASE";

  useEffect(() => {
    if (state?.ok) {
      // Clear uncontrolled fields (amount, payee, check, note); date + category
      // are controlled state so they stay put for the next entry.
      formRef.current?.reset();
      amountRef.current?.focus();
    }
  }, [state?.ok]);

  return (
    <form ref={formRef} action={action} className="mb-4">
      <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low/40 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Date" className="w-[140px]">
            <input name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ft-input" required />
          </Field>

          <Field label="Category" className="w-[190px]">
            <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className="ft-input">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{expenseCatLabel(c)}</option>
              ))}
            </select>
          </Field>

          <Field label={isInventory ? "Vendor" : "Expense type"} className="min-w-[200px] flex-1">
            {fixedSubOptions ? (
              <select name="payee" key={category} className="ft-input" defaultValue="">
                <option value="" disabled>— Select type —</option>
                {fixedSubOptions.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <>
                <input name="payee" type="text" list="qer-vendor-options" className="ft-input" placeholder="Select or type a vendor" autoComplete="off" />
                <datalist id="qer-vendor-options">
                  {(vendorSuggestions ?? []).map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </>
            )}
          </Field>

          {isInventory && (
            <Field label="Check #" className="w-[120px]">
              <input name="checkNo" type="text" inputMode="numeric" className="ft-input" placeholder="e.g. 1042" autoComplete="off" />
            </Field>
          )}

          <Field label="Amount" className="w-[120px]">
            <input ref={amountRef} name="amount" type="number" step="0.01" min="0" className="ft-input" placeholder="0.00" required />
          </Field>

          <Field label="Method" className="w-[110px]">
            <select name="paymentMethod" className="ft-input" defaultValue={isInventory ? "OTHER" : "CASH"}>
              {PAYMENTS.map((p) => (
                <option key={p} value={p}>{paymentLabel(p)}</option>
              ))}
            </select>
          </Field>

          <button type="submit" disabled={pending} className="ft-btn-primary h-[42px] px-4 justify-center whitespace-nowrap">
            <Icon name="add" className="text-[18px]" /> {pending ? "Adding…" : "Add"}
          </button>
        </div>

        {state?.error && (
          <div className="mt-2 flex items-center gap-2 text-error text-body-sm">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}
      </div>
    </form>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="ft-label">{label}</label>
      {children}
    </div>
  );
}
