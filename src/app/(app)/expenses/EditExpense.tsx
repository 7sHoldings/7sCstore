"use client";

import { useActionState, useEffect, useState } from "react";
import { updateExpense } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";
import { expenseCatLabel, paymentLabel } from "@/lib/format";
import OptionSelect from "./OptionSelect";

const CATEGORIES = ["STORE_OPERATING_EXPENSES", "INVENTORY_PURCHASE"];
const PAYMENTS = ["CASH", "CARD", "CHECK", "OTHER"];

export interface ExpenseEntry {
  id: string;
  date: string; // yyyy-mm-dd
  category: string;
  amount: number;
  payee: string;
  checkNo: string;
  paymentMethod: string;
  note: string;
  recurring: boolean;
}

/** Pencil button that opens a prefilled modal to edit one expense. */
export default function EditExpense({
  entry,
  operatingTypes,
  vendors,
}: {
  entry: ExpenseEntry;
  operatingTypes: string[];
  vendors: string[];
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(entry.category);
  const [state, action, pending] = useActionState(updateExpense, {});

  const isInventory = category === "INVENTORY_PURCHASE";

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state?.ok]);

  if (!open) {
    return (
      <button
        onClick={() => { setCategory(entry.category); setOpen(true); }}
        className="text-on-surface-variant hover:text-primary transition-colors p-1.5 rounded-md"
        aria-label="Edit"
      >
        <Icon name="edit" className="text-[18px]" />
      </button>
    );
  }

  return (
    <Modal title="Edit Expense" onClose={() => setOpen(false)}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="id" value={entry.id} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="ee-date">Date</label>
            <input id="ee-date" name="date" type="date" defaultValue={entry.date} className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="ee-amount">Amount</label>
            <input id="ee-amount" name="amount" type="number" step="0.01" min="0" defaultValue={entry.amount} className="ft-input" required />
          </div>
        </div>

        <div>
          <label className="ft-label" htmlFor="ee-category">Category</label>
          <select id="ee-category" name="category" className="ft-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{expenseCatLabel(c)}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label">{isInventory ? "Vendor" : "Expense type"}</label>
            <OptionSelect
              key={category}
              name="payee"
              kind={isInventory ? "VENDOR" : "EXPENSE_TYPE"}
              options={isInventory ? vendors : operatingTypes}
              placeholder={isInventory ? "Select or add a vendor" : "Select or add a type"}
              initial={category === entry.category ? entry.payee : ""}
            />
          </div>
          <div>
            <label className="ft-label" htmlFor="ee-method">Payment method</label>
            <select id="ee-method" name="paymentMethod" className="ft-input" defaultValue={entry.paymentMethod}>
              {PAYMENTS.map((p) => (
                <option key={p} value={p}>{paymentLabel(p)}</option>
              ))}
            </select>
          </div>
        </div>

        {isInventory && (
          <div>
            <label className="ft-label" htmlFor="ee-checkNo">Check #</label>
            <input id="ee-checkNo" name="checkNo" type="text" inputMode="numeric" defaultValue={entry.checkNo} className="ft-input" placeholder="e.g. 1042" autoComplete="off" />
          </div>
        )}

        <div>
          <label className="ft-label" htmlFor="ee-note">Note (optional)</label>
          <input id="ee-note" name="note" type="text" defaultValue={entry.note} className="ft-input" placeholder="Reference / details" />
        </div>

        <label className="flex items-center gap-2 text-body-md text-on-surface">
          <input type="checkbox" name="recurring" defaultChecked={entry.recurring} className="w-4 h-4 accent-[#0a2540]" />
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
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
