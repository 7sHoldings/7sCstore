"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createMoneyIncoming } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";

const FIELDS: [string, string][] = [
  ["rent", "Rent"],
  ["gameMachine", "Game Machine Credit"],
  ["stagityInvestment", "Stagity Investment"],
  ["beer", "Beer"],
];

export default function MoneyIncomingForm({ defaultDate }: { defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createMoneyIncoming, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) { formRef.current?.reset(); setOpen(false); }
  }, [state?.ok]);

  if (!open) {
    return (
      <button className="ft-btn-primary" onClick={() => setOpen(true)}>
        <Icon name="add" className="text-[18px]" /> New Income
      </button>
    );
  }

  return (
    <Modal title="Record Money Incoming" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div>
          <label className="ft-label" htmlFor="date">Date</label>
          <input id="date" name="date" type="date" defaultValue={defaultDate} className="ft-input" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map(([name, label]) => (
            <div key={name}>
              <label className="ft-label" htmlFor={name}>{label}</label>
              <input id={name} name={name} type="number" step="0.01" min="0" className="ft-input" placeholder="0.00" />
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
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
