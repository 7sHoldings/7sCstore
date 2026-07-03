"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { setCashForDay, resetCashForDay } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";
import { fmtMoney } from "@/lib/format";

export default function EditCashButton({
  date,
  pos,
  manual,
  effective,
}: {
  date: string;
  pos: number | null;
  manual: number | null;
  effective: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setCashForDay, {});
  const [amount, setAmount] = useState(""); // start empty so you type a fresh number
  const [resetting, startReset] = useTransition();

  useEffect(() => { if (state?.ok) setOpen(false); }, [state?.ok]);

  const label = new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ft-btn-ghost p-1.5 rounded-md" aria-label="Edit cash" title="Edit cash">
        <Icon name="edit" className="text-[18px]" />
      </button>
    );
  }

  return (
    <Modal title={`Cash · ${label}`} onClose={() => setOpen(false)}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="date" value={date} />
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-container-low p-3">
          <Stat label="POS Safe Drop" value={pos != null ? fmtMoney(pos) : "—"} />
          <Stat label="Current" value={fmtMoney(effective)} tone={manual != null ? "secondary" : undefined} hint={manual != null ? "manual" : pos != null ? "from POS" : undefined} />
        </div>

        <div>
          <label className="ft-label" htmlFor="cash-amt">Cash amount</label>
          <input id="cash-amt" name="amount" type="number" step="0.01" min="0" className="ft-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required autoFocus />
          <p className="text-[11px] text-on-surface-variant mt-1">Saved as a manual override — it wins over the POS Safe Drop and survives the next sync.</p>
        </div>

        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {manual != null && pos != null && (
            <button
              type="button"
              disabled={resetting || pending}
              onClick={() => startReset(async () => { await resetCashForDay(date); setOpen(false); })}
              className="ft-btn-ghost justify-center"
              title="Discard the manual override and use the POS Safe Drop"
            >
              {resetting ? "Resetting…" : "Reset to POS"}
            </button>
          )}
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "secondary"; hint?: string }) {
  return (
    <div>
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className={`tabular text-base font-bold ${tone === "secondary" ? "text-secondary" : "text-on-surface"}`}>{value}</div>
      {hint && <div className="text-[10px] uppercase tracking-wide text-on-surface-variant/70">{hint}</div>}
    </div>
  );
}
