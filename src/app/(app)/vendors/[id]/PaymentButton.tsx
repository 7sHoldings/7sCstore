"use client";

import { useState, useTransition } from "react";
import { recordVendorPayment } from "../actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";

export default function PaymentButton({ id, balance }: { id: string; balance: number }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button className="ft-btn-primary" onClick={() => setOpen(true)} disabled={balance <= 0}>
        <Icon name="payments" className="text-[18px]" /> Record Payment
      </button>
    );
  }

  return (
    <Modal title="Record a Vendor Payment" onClose={() => setOpen(false)}>
      <div className="space-y-4">
        <p className="text-body-md text-on-surface-variant">
          Current balance owed: <span className="tabular font-semibold text-error">${balance.toFixed(2)}</span>
        </p>
        <div>
          <label className="ft-label" htmlFor="amt">Payment amount</label>
          <input
            id="amt"
            type="number"
            step="0.01"
            min="0"
            max={balance}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="ft-input"
            placeholder="0.00"
          />
        </div>
        <div className="flex gap-2">
          <button className="ft-btn-secondary flex-1 justify-center" onClick={() => setOpen(false)}>Cancel</button>
          <button
            className="ft-btn-primary flex-1 justify-center"
            disabled={pending || !amount}
            onClick={() =>
              start(async () => {
                await recordVendorPayment(id, Number(amount));
                setOpen(false);
                setAmount("");
              })
            }
          >
            {pending ? "Saving…" : "Record payment"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
