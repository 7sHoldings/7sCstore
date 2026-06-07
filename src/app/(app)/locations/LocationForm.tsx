"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createLocation } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";

export default function LocationForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createLocation, {});
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
        <Icon name="add" className="text-[18px]" /> New Location
      </button>
    );
  }

  return (
    <Modal title="Add a Location" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div>
          <label className="ft-label" htmlFor="name">Location name</label>
          <input id="name" name="name" type="text" className="ft-input" placeholder="e.g. I-95 North Express" required />
        </div>
        <div>
          <label className="ft-label" htmlFor="address">Address</label>
          <input id="address" name="address" type="text" className="ft-input" placeholder="optional" />
        </div>
        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Add location"}</button>
        </div>
      </form>
    </Modal>
  );
}
