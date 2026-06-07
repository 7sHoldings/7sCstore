"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createUser } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";
import { ROLE_LABELS } from "@/lib/rbac";

const ROLES = ["OWNER", "MANAGER", "ACCOUNTANT", "EMPLOYEE"] as const;

export default function UserForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createUser, {});
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
        <Icon name="person_add" className="text-[18px]" /> New User
      </button>
    );
  }

  return (
    <Modal title="Add a User" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div>
          <label className="ft-label" htmlFor="u-name">Name</label>
          <input id="u-name" name="name" type="text" className="ft-input" required />
        </div>
        <div>
          <label className="ft-label" htmlFor="u-email">Email</label>
          <input id="u-email" name="email" type="email" className="ft-input" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="u-role">Role</label>
            <select id="u-role" name="role" className="ft-input" defaultValue="EMPLOYEE">
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <div>
            <label className="ft-label" htmlFor="u-pass">Temporary password</label>
            <input id="u-pass" name="password" type="text" minLength={8} className="ft-input" placeholder="min 8 chars" required />
          </div>
        </div>

        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Add user"}</button>
        </div>
      </form>
    </Modal>
  );
}
