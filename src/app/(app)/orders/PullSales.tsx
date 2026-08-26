"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";
import { refreshDemand } from "./actions";

/**
 * Pull sales from the POS and report the outcome.
 *
 * The POS session expires, and a silent failure is indistinguishable from a
 * successful pull that found nothing — so every run says what it read, over
 * what stretch, and what it changed.
 */
export default function PullSales() {
  const router = useRouter();
  const [state, action, pending] = useActionState(refreshDemand, {});

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <div className="flex flex-col items-start gap-2">
      <form action={action}>
        <button type="submit" disabled={pending} className="ft-btn-secondary py-1.5">
          {pending ? (
            <>
              <Icon name="progress_activity" className="text-[18px] animate-spin" />
              Reading sales…
            </>
          ) : (
            <>
              <Icon name="download" className="text-[18px]" />
              Pull sales history
            </>
          )}
        </button>
      </form>

      {pending && (
        <p className="text-body-sm text-on-surface-variant max-w-md">
          Reading every product week by week — this takes a minute or two on a full
          catalogue. Leave the page open.
        </p>
      )}

      {!pending && state?.message && (
        <p className="text-body-sm text-secondary max-w-md flex items-start gap-1.5">
          <Icon name="check_circle" className="text-[16px] mt-0.5 shrink-0" />
          {state.message}
        </p>
      )}

      {!pending && state?.error && (
        <p className="text-body-sm text-error max-w-md flex items-start gap-1.5">
          <Icon name="error" className="text-[16px] mt-0.5 shrink-0" />
          {state.error}
        </p>
      )}
    </div>
  );
}
