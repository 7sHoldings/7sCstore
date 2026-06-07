"use client";

import { useActionState } from "react";
import { triggerSync } from "./actions";
import { Icon } from "@/components/ui";

export default function SyncButton() {
  const [state, action, pending] = useActionState(
    async () => triggerSync(),
    {} as { error?: string; ok?: boolean; imported?: number }
  );

  return (
    <form action={action} className="flex items-center gap-3">
      <button type="submit" disabled={pending} className="ft-btn-primary">
        <Icon name={pending ? "sync" : "sync"} className={`text-[18px] ${pending ? "animate-spin" : ""}`} />
        {pending ? "Syncing…" : "Sync now"}
      </button>
      {state?.ok && (
        <span className="text-secondary text-body-sm flex items-center gap-1">
          <Icon name="check_circle" className="text-[18px]" /> Imported {state.imported} records
        </span>
      )}
      {state?.error && (
        <span className="text-error text-body-sm flex items-center gap-1">
          <Icon name="error" className="text-[18px]" /> {state.error}
        </span>
      )}
    </form>
  );
}
