"use client";

import { useState, useTransition } from "react";
import { pushPricesToPos } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";

/**
 * Bulk price-push for the current view. Scoped to the active department/category
 * filter (the server rejects an unscoped push). Shows a confirm step with the
 * item count before writing to the POS.
 */
export default function BulkPushButton({
  filter,
  count,
  scopeLabel,
}: {
  filter: { q?: string; cat?: string; dept?: string };
  count: number;
  scopeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    start(async () => {
      const r = await pushPricesToPos(filter);
      setResult({ ok: Boolean(r.ok), text: r.message || r.error || "Done." });
    });
  }

  return (
    <>
      <button onClick={() => { setResult(null); setOpen(true); }} className="ft-btn-secondary h-9 whitespace-nowrap" title="Push every app price in this view to the POS">
        <Icon name="cloud_upload" className="text-[18px]" /> Push prices to POS
      </button>

      {open && (
        <Modal title="Push prices to POS" onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <div className="rounded-lg bg-surface-container-low p-3 text-body-sm text-on-surface">
              This sets the register retail at the store to match the app price for
              <span className="font-semibold"> {count.toLocaleString()} </span>
              POS-linked product{count === 1 ? "" : "s"} in <span className="font-semibold">{scopeLabel}</span>.
              Items already at the same price are skipped.
            </div>
            <div className="flex items-center gap-2 text-body-sm text-tertiary bg-tertiary-container/30 px-3 py-2 rounded-md">
              <Icon name="warning" className="text-[18px]" />
              This changes live shelf prices. Test on one item before a large push.
            </div>

            {result && (
              <div className={`flex items-center gap-2 text-body-sm px-3 py-2 rounded-md ${result.ok ? "text-secondary bg-secondary-container/40" : "text-error bg-error-container/50"}`}>
                <Icon name={result.ok ? "check_circle" : "error"} className="text-[18px]" /> {result.text}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">
                {result?.ok ? "Close" : "Cancel"}
              </button>
              {!result?.ok && (
                <button type="button" onClick={run} disabled={pending || count === 0} className="ft-btn-primary flex-1 justify-center">
                  {pending ? "Pushing…" : `Push ${count.toLocaleString()}`}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
