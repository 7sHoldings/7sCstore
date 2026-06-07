"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { updateLocation, deleteLocation } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";

export default function LocationManager({
  id,
  name,
  address,
  canDelete,
}: {
  id: string;
  name: string;
  address: string | null;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateLocation, {});
  const [delPending, startDelete] = useTransition();
  const [delErr, setDelErr] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state?.ok]);

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setEditing(true)}
          className="ft-btn-ghost p-1.5 rounded-md"
          aria-label="Edit location"
          title="Edit"
        >
          <Icon name="edit" className="text-[18px]" />
        </button>
        {canDelete && (
          <button
            disabled={delPending}
            onClick={() => {
              setDelErr(null);
              if (confirm(`Delete location "${name}"?`)) {
                startDelete(async () => {
                  const r = await deleteLocation(id);
                  if (r?.error) setDelErr(r.error);
                });
              }
            }}
            className="text-on-surface-variant hover:text-error transition-colors p-1.5 rounded-md disabled:opacity-50"
            aria-label="Delete location"
            title="Delete"
          >
            <Icon name={delPending ? "hourglass_empty" : "delete"} className="text-[18px]" />
          </button>
        )}
      </div>
      {delErr && <p className="text-body-sm text-error mt-2">{delErr}</p>}

      {editing && (
        <Modal title="Edit Location" onClose={() => setEditing(false)}>
          <form ref={formRef} action={action} className="space-y-4">
            <input type="hidden" name="id" value={id} />
            <div>
              <label className="ft-label" htmlFor={`name-${id}`}>Location name</label>
              <input id={`name-${id}`} name="name" type="text" defaultValue={name} className="ft-input" required />
            </div>
            <div>
              <label className="ft-label" htmlFor={`addr-${id}`}>Address</label>
              <input id={`addr-${id}`} name="address" type="text" defaultValue={address ?? ""} className="ft-input" placeholder="optional" />
            </div>
            {state?.error && (
              <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
                <Icon name="error" className="text-[18px]" /> {state.error}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setEditing(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
              <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Save changes"}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
