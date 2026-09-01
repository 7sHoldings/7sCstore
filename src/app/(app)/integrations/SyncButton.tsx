"use client";

import { useActionState } from "react";
import { triggerSync } from "./actions";
import { Icon } from "@/components/ui";

export default function SyncButton() {
  const [state, action, pending] = useActionState(
    async () => triggerSync(),
    {} as { error?: string; ok?: boolean; imported?: number }
  );

  // Stacked on a phone, side by side from sm up. A sync failure is a paragraph,
  // not a word — laying it beside the button on a narrow screen squeezes the
  // button into a corner and wrings the message into a tall ribbon of text.
  return (
    <form action={action} className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
      <button type="submit" disabled={pending} className="ft-btn-primary justify-center sm:w-auto">
        <Icon name="sync" className={`text-[18px] ${pending ? "animate-spin" : ""}`} />
        {pending ? "Syncing…" : "Sync now"}
      </button>
      {state?.ok && (
        <span className="text-secondary text-body-sm flex items-start gap-1.5 sm:max-w-xs">
          <Icon name="check_circle" className="text-[18px] shrink-0" />
          Imported {state.imported} records
        </span>
      )}
      {state?.error && (
        <span className="text-error text-body-sm flex items-start gap-1.5 sm:max-w-md">
          <Icon name="error" className="text-[18px] shrink-0" />
          <span>{state.error}</span>
        </span>
      )}
    </form>
  );
}
