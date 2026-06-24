"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createExpense } from "./actions";
import { Icon } from "@/components/ui";
import { expenseCatLabel, paymentLabel } from "@/lib/format";
import OptionSelect from "./OptionSelect";

const CATEGORIES = ["STORE_OPERATING_EXPENSES", "INVENTORY_PURCHASE"];
const PAYMENTS = ["CASH", "CARD", "CHECK", "OTHER"];

// Always-visible inline entry row — fill left to right and hit Add (or Enter)
// to save. Date + Category stay put so you can log many rows quickly; the
// amount field re-focuses after each save.
export default function QuickExpenseRow({
  defaultDate,
  operatingTypes,
  vendors,
}: {
  defaultDate: string;
  operatingTypes: string[];
  vendors: string[];
}) {
  const [state, action, pending] = useActionState(createExpense, {});
  const [date, setDate] = useState(defaultDate);
  const [category, setCategory] = useState("STORE_OPERATING_EXPENSES");
  const [nonce, setNonce] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const isInventory = category === "INVENTORY_PURCHASE";

  useEffect(() => {
    if (state?.ok) {
      // Clear uncontrolled fields (amount, check); date + category are controlled
      // state so they stay put. Bumping nonce remounts the OptionSelect to clear
      // its selection for the next entry.
      formRef.current?.reset();
      setNonce((n) => n + 1);
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
            <OptionSelect
              key={`${category}-${nonce}`}
              name="payee"
              kind={isInventory ? "VENDOR" : "EXPENSE_TYPE"}
              options={isInventory ? vendors : operatingTypes}
              placeholder={isInventory ? "Select or add a vendor" : "Select or add a type"}
            />
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
            <select name="paymentMethod" key={category} className="ft-input" defaultValue={isInventory ? "CHECK" : "CASH"}>
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
