"use client";

import { useActionState, useEffect, useState } from "react";
import { saveLotteryNumbers } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";
import { fmtMoney } from "@/lib/format";

export default function EditLotteryButton({
  date,
  sales,
  payout,
  credit = 0,
  label = "Edit",
}: {
  date: string;
  sales: number;
  payout: number;
  credit?: number;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveLotteryNumbers, {});
  const [salesV, setSalesV] = useState(String(sales || ""));
  const [payoutV, setPayoutV] = useState(String(payout || ""));
  const [creditV, setCreditV] = useState(String(credit || ""));

  useEffect(() => { if (state?.ok) setOpen(false); }, [state?.ok]);

  const net = (Number(salesV) || 0) - (Number(payoutV) || 0) - (Number(creditV) || 0);
  const dayLabel = new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-primary text-[11px] font-medium underline" title="Edit manual lottery numbers">
        {label}
      </button>
    );
  }

  return (
    <Modal title={`Manual Lottery · ${dayLabel}`} onClose={() => setOpen(false)}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="date" value={date} />
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="ft-label" htmlFor="lt-sales">Lottery Sales ($)</label>
            <input id="lt-sales" name="sales" type="number" step="0.01" min="0" className="ft-input" value={salesV} onChange={(e) => setSalesV(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="ft-label" htmlFor="lt-payout">Lotto Payout ($)</label>
            <input id="lt-payout" name="payout" type="number" step="0.01" min="0" className="ft-input" value={payoutV} onChange={(e) => setPayoutV(e.target.value)} required />
          </div>
          <div>
            <label className="ft-label" htmlFor="lt-credit">Lotto Credit ($)</label>
            <input id="lt-credit" name="credit" type="number" step="0.01" min="0" className="ft-input" value={creditV} onChange={(e) => setCreditV(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
          <span className="text-label-caps uppercase text-on-surface-variant">Net (sales − payout − credit)</span>
          <span className="tabular font-bold text-on-surface">{fmtMoney(net)}</span>
        </div>
        <p className="text-[11px] text-on-surface-variant">Quick numbers-only edit. To attach a receipt photo, use the full Lottery Entry page.</p>

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
