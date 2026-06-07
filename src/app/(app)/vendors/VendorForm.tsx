"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createVendor } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";

export default function VendorForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createVendor, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state?.ok]);

  if (!open) {
    return (
      <button className="ft-btn-primary" onClick={() => setOpen(true)}>
        <Icon name="add" className="text-[18px]" /> New Vendor
      </button>
    );
  }

  return (
    <Modal title="Add a Vendor" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div>
          <label className="ft-label" htmlFor="name">Vendor name</label>
          <input id="name" name="name" type="text" className="ft-input" placeholder="e.g. Core-Mark Distribution" required />
        </div>
        <div>
          <label className="ft-label" htmlFor="contact">Contact</label>
          <input id="contact" name="contact" type="text" className="ft-input" placeholder="email / phone" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="terms">Payment terms</label>
            <input id="terms" name="terms" type="text" className="ft-input" placeholder="e.g. Net 30" />
          </div>
          <div>
            <label className="ft-label" htmlFor="balanceOwed">Opening balance owed</label>
            <input id="balanceOwed" name="balanceOwed" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" />
          </div>
        </div>

        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Add vendor"}</button>
        </div>
      </form>
    </Modal>
  );
}
