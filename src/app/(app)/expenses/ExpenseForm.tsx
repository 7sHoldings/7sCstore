"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createExpense } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";
import { expenseCatLabel, paymentLabel } from "@/lib/format";
import { fixedSubOptionsFor, vendorSuggestionsFor } from "@/lib/expenseOptions";

const CATEGORIES = ["STORE_OPERATING_EXPENSES", "INVENTORY_PURCHASE"];
const PAYMENTS = ["CASH", "CARD", "OTHER"];

export default function ExpenseForm({ defaultDate }: { defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("STORE_OPERATING_EXPENSES");
  const [state, action, pending] = useActionState(createExpense, {});
  const formRef = useRef<HTMLFormElement>(null);

  const fixedSubOptions = fixedSubOptionsFor(category);
  const vendorSuggestions = vendorSuggestionsFor(category);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setCategory("STORE_OPERATING_EXPENSES");
      setOpen(false);
    }
  }, [state?.ok]);

  if (!open) {
    return (
      <button className="ft-btn-primary" onClick={() => setOpen(true)}>
        <Icon name="add" className="text-[18px]" /> New Expense
      </button>
    );
  }

  return (
    <Modal title="Record an Expense" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="date">Date</label>
            <input id="date" name="date" type="date" defaultValue={defaultDate} className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="amount">Amount</label>
            <input id="amount" name="amount" type="number" step="0.01" min="0" className="ft-input" placeholder="0.00" required />
          </div>
        </div>

        <div>
          <label className="ft-label" htmlFor="category">Category</label>
          <select id="category" name="category" className="ft-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{expenseCatLabel(c)}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            {fixedSubOptions ? (
              <>
                <label className="ft-label" htmlFor="payee">Expense type</label>
                <select id="payee" name="payee" key={category} className="ft-input" defaultValue="">
                  <option value="" disabled>— Select type —</option>
                  {fixedSubOptions.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </>
            ) : vendorSuggestions ? (
              <>
                <label className="ft-label" htmlFor="payee">Vendor</label>
                <input id="payee" name="payee" type="text" list="vendor-options" className="ft-input" placeholder="Select or type a vendor" autoComplete="off" />
                <datalist id="vendor-options">
                  {vendorSuggestions.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </>
            ) : (
              <>
                <label className="ft-label" htmlFor="payee">Vendor / Payee</label>
                <input id="payee" name="payee" type="text" className="ft-input" placeholder="e.g. City Utilities" />
              </>
            )}
          </div>
          <div>
            <label className="ft-label" htmlFor="paymentMethod">Payment method</label>
            <select id="paymentMethod" name="paymentMethod" className="ft-input" defaultValue="CARD">
              {PAYMENTS.map((p) => (
                <option key={p} value={p}>{paymentLabel(p)}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="ft-label" htmlFor="note">Note (optional)</label>
          <input id="note" name="note" type="text" className="ft-input" placeholder="Reference / details" />
        </div>

        <label className="flex items-center gap-2 text-body-md text-on-surface">
          <input type="checkbox" name="recurring" className="w-4 h-4 accent-[#0a2540]" />
          Recurring expense (remind me monthly)
        </label>

        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">
            {pending ? "Saving…" : "Save expense"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
