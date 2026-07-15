"use client";

import { useActionState, useEffect, useState } from "react";
import { editHouseCharge, editHousePayment } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";

export type HouseEntry =
  | { kind: "payment"; id: string; account: string; amount: number; date: string; note?: string }
  | { kind: "charge"; account: string; amount: number; date: string };

/** Pencil button that opens a prefilled modal to edit one house-account entry. */
export default function EditHouseEntry({ entry, accounts }: { entry: HouseEntry; accounts: string[] }) {
  const [open, setOpen] = useState(false);
  const isPayment = entry.kind === "payment";
  const [state, action, pending] = useActionState(isPayment ? editHousePayment : editHouseCharge, {});

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state?.ok]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-on-surface-variant hover:text-primary transition-colors p-1.5 rounded-md"
        aria-label={isPayment ? "Edit payment" : "Edit charge"}
      >
        <Icon name="edit" className="text-[18px]" />
      </button>
    );
  }

  return (
    <Modal title={isPayment ? `Edit payment — ${entry.account}` : `Edit charge — ${entry.account}`} onClose={() => setOpen(false)}>
      <form action={action} className="space-y-4">
        {isPayment ? (
          <>
            <input type="hidden" name="id" value={entry.id} />
            <div>
              <label className="ft-label" htmlFor="he-account">Account</label>
              <select id="he-account" name="account" className="ft-input w-full" defaultValue={entry.account}>
                {(accounts.includes(entry.account) ? accounts : [entry.account, ...accounts]).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <input type="hidden" name="origDate" value={entry.date} />
            <input type="hidden" name="account" value={entry.account} />
            <input type="hidden" name="oldAmount" value={entry.amount} />
            <p className="text-body-sm text-on-surface-variant">
              This charge comes from the day&apos;s Credit Entry. Set the amount to 0 to remove it.
            </p>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="he-amount">Amount ($)</label>
            <input
              id="he-amount" name="amount" type="number" step="0.01" min="0"
              defaultValue={entry.amount} className="ft-input" required
            />
          </div>
          <div>
            <label className="ft-label" htmlFor="he-date">Date</label>
            <input id="he-date" name="date" type="date" defaultValue={entry.date} className="ft-input" />
          </div>
        </div>

        {isPayment && (
          <div>
            <label className="ft-label" htmlFor="he-note">Note (optional)</label>
            <input id="he-note" name="note" defaultValue={entry.note ?? ""} className="ft-input" placeholder="e.g. cash, check #123" />
          </div>
        )}

        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </Modal>
  );
}
