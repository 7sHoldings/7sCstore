"use client";

import { useActionState, useEffect, useState } from "react";
import { updateMoneyIncoming } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";

const FIELDS: [string, string][] = [
  ["rent", "Rent"],
  ["gameMachine", "Game Machine Credit"],
  ["stagityInvestment", "Stagity Investment"],
  ["beer", "Beer"],
];

export interface MoneyIncomingEntry {
  id: string;
  date: string; // yyyy-mm-dd
  rent: number;
  gameMachine: number;
  stagityInvestment: number;
  beer: number;
}

/** Pencil button that opens a prefilled modal to edit one Money Incoming entry. */
export default function EditMoneyIncoming({ entry }: { entry: MoneyIncomingEntry }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateMoneyIncoming, {});

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state?.ok]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-on-surface-variant hover:text-primary transition-colors p-1.5 rounded-md"
        aria-label="Edit"
      >
        <Icon name="edit" className="text-[18px]" />
      </button>
    );
  }

  return (
    <Modal title="Edit Money Incoming" onClose={() => setOpen(false)}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="id" value={entry.id} />
        <div>
          <label className="ft-label" htmlFor="edit-date">Date</label>
          <input id="edit-date" name="date" type="date" defaultValue={entry.date} className="ft-input" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map(([name, label]) => (
            <div key={name}>
              <label className="ft-label" htmlFor={`edit-${name}`}>{label}</label>
              <input
                id={`edit-${name}`}
                name={name}
                type="number"
                step="0.01"
                min="0"
                defaultValue={entry[name as keyof MoneyIncomingEntry] || ""}
                className="ft-input"
                placeholder="0.00"
              />
            </div>
          ))}
        </div>
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
