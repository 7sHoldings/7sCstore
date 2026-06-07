"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createShift } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";
import { fmtMoney } from "@/lib/format";

export default function ShiftForm({
  defaultDate,
  users,
}: {
  defaultDate: string;
  users: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createShift, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Live preview of expected cash & variance.
  const [openCash, setOpenCash] = useState(0);
  const [cashSales, setCashSales] = useState(0);
  const [payouts, setPayouts] = useState(0);
  const [cashDrop, setCashDrop] = useState(0);
  const [closeCash, setCloseCash] = useState(0);
  const expected = openCash + cashSales - payouts - cashDrop;
  const variance = closeCash - expected;

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state?.ok]);

  if (!open) {
    return (
      <button className="ft-btn-primary" onClick={() => setOpen(true)}>
        <Icon name="add" className="text-[18px]" /> New Shift
      </button>
    );
  }

  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value) || 0);

  return (
    <Modal title="Record a Shift" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="s-date">Date</label>
            <input id="s-date" name="date" type="date" defaultValue={defaultDate} className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="userId">Employee</label>
            <select id="userId" name="userId" className="ft-input" defaultValue="">
              <option value="">— unassigned —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="ft-label" htmlFor="startTime">Start time</label>
            <input id="startTime" name="startTime" type="time" className="ft-input" />
          </div>
          <div>
            <label className="ft-label" htmlFor="endTime">End time</label>
            <input id="endTime" name="endTime" type="time" className="ft-input" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 bg-surface-container-low rounded-md p-3">
          <div>
            <label className="ft-label" htmlFor="openCash">Opening cash</label>
            <input id="openCash" name="openCash" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" onChange={num(setOpenCash)} />
          </div>
          <div>
            <label className="ft-label" htmlFor="cashSales">Cash sales</label>
            <input id="cashSales" name="cashSales" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" onChange={num(setCashSales)} />
          </div>
          <div>
            <label className="ft-label" htmlFor="payouts">Cash payouts</label>
            <input id="payouts" name="payouts" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" onChange={num(setPayouts)} />
          </div>
          <div>
            <label className="ft-label" htmlFor="cashDrop">Cash drop to safe</label>
            <input id="cashDrop" name="cashDrop" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" onChange={num(setCashDrop)} />
          </div>
          <div className="col-span-2">
            <label className="ft-label" htmlFor="closeCash">Counted closing cash</label>
            <input id="closeCash" name="closeCash" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" onChange={num(setCloseCash)} />
          </div>
        </div>

        {/* Live reconciliation preview */}
        <div className="flex items-center justify-between rounded-md px-3 py-2 bg-surface-container">
          <div className="text-body-sm">
            <span className="text-on-surface-variant">Expected </span>
            <span className="tabular font-semibold">{fmtMoney(expected)}</span>
          </div>
          <div className={`text-body-sm font-semibold ${variance < 0 ? "text-error" : variance > 0 ? "text-secondary" : "text-on-surface-variant"}`}>
            {variance === 0 ? "Balanced" : variance < 0 ? `Short ${fmtMoney(Math.abs(variance))}` : `Over ${fmtMoney(variance)}`}
          </div>
        </div>

        <div>
          <label className="ft-label" htmlFor="note">Note</label>
          <input id="note" name="note" type="text" className="ft-input" placeholder="optional" />
        </div>

        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Save shift"}</button>
        </div>
      </form>
    </Modal>
  );
}
