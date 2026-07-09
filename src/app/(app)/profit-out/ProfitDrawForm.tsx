"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveProfitDraw } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";

export type Draw = { id: string; date: string; amount: number; note: string | null };

export default function ProfitDrawForm({ draw, defaultDate }: { draw?: Draw; defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveProfitDraw, {});
  const formRef = useRef<HTMLFormElement>(null);
  const editing = Boolean(draw);

  useEffect(() => { if (state?.ok) { setOpen(false); if (!editing) formRef.current?.reset(); } }, [state?.ok, editing]);

  if (!open) {
    return editing ? (
      <button onClick={() => setOpen(true)} className="ft-btn-ghost p-1.5 rounded-md" aria-label="Edit entry" title="Edit">
        <Icon name="edit" className="text-[18px]" />
      </button>
    ) : (
      <button onClick={() => setOpen(true)} className="ft-btn-primary">
        <Icon name="add" className="text-[18px]" /> Add profit taken out
      </button>
    );
  }

  return (
    <Modal title={editing ? "Edit profit taken out" : "Profit taken out"} onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        {draw && <input type="hidden" name="id" value={draw.id} />}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="pd-date">Date</label>
            <input id="pd-date" name="date" type="date" defaultValue={draw?.date ?? defaultDate} className="ft-input" required autoFocus />
          </div>
          <div>
            <label className="ft-label" htmlFor="pd-amt">Amount ($)</label>
            <input id="pd-amt" name="amount" type="number" step="0.01" min="0" defaultValue={draw?.amount ?? ""} className="ft-input" placeholder="0.00" required />
          </div>
        </div>
        <div>
          <label className="ft-label" htmlFor="pd-note">Note (optional)</label>
          <input id="pd-note" name="note" type="text" defaultValue={draw?.note ?? ""} className="ft-input" placeholder="e.g. owner draw, transfer to personal" />
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
