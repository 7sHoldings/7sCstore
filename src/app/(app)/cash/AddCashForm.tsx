"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { setCashForDay } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";

export default function AddCashForm({ defaultDate }: { defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setCashForDay, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => { if (state?.ok) { setOpen(false); formRef.current?.reset(); } }, [state?.ok]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ft-btn-primary">
        <Icon name="add" className="text-[18px]" /> Add / set cash
      </button>
    );
  }

  return (
    <Modal title="Set cash for a day" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="ac-date">Date</label>
            <input id="ac-date" name="date" type="date" defaultValue={defaultDate} className="ft-input" required autoFocus />
          </div>
          <div>
            <label className="ft-label" htmlFor="ac-amt">Cash amount</label>
            <input id="ac-amt" name="amount" type="number" step="0.01" min="0" className="ft-input" placeholder="0.00" required />
          </div>
        </div>
        <p className="text-[11px] text-on-surface-variant">Sets a manual cash value for that day (overrides the POS Safe Drop and shows on the Daily page).</p>

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
