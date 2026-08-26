"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Icon, Badge } from "@/components/ui";
import { setDepartmentMargin } from "./actions";

/**
 * Per-department target margins. Departments are the granularity that matters
 * in a c-store: candy carries 40% while cigarettes run far thinner, so one
 * store-wide number would price tobacco out of the market.
 */
export default function MarginSettings({
  departments,
  margins,
  fallback,
  canEdit,
}: {
  departments: string[];
  margins: Record<string, number>;
  fallback: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setDepartmentMargin, {});

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const set = departments.filter((d) => margins[d] != null).length;

  return (
    <Card className="mb-6 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-surface-container-low/50"
      >
        <span className="flex items-center gap-2 font-semibold text-on-surface">
          <Icon name="percent" className="text-[20px] text-primary" />
          Target margin by department
          <Badge tone={set ? "info" : "neutral"}>
            {set} of {departments.length} set
          </Badge>
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} className="text-on-surface-variant" />
      </button>

      {open && (
        <div className="border-t border-outline-variant/60 p-4">
          <p className="text-body-sm text-on-surface-variant mb-3">
            Departments without a setting use <strong>{fallback}%</strong>. Set them as you go —
            the target price and the &ldquo;below floor&rdquo; flag update immediately.
          </p>

          {state?.error && (
            <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md mb-3">
              <Icon name="error" className="text-[18px]" /> {state.error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {departments.map((d) => {
              const current = margins[d];
              return (
                <form key={d} action={action} className="flex items-center gap-2">
                  <input type="hidden" name="department" value={d} readOnly />
                  <label className="flex-1 text-body-sm text-on-surface truncate" htmlFor={`m-${d}`}>
                    {d}
                  </label>
                  <input
                    id={`m-${d}`}
                    name="marginPct"
                    type="number"
                    step="0.5"
                    min="0"
                    max="95"
                    defaultValue={current ?? ""}
                    placeholder={String(fallback)}
                    disabled={!canEdit}
                    className="ft-input py-1 text-body-sm w-20 tabular"
                  />
                  <span className="text-body-sm text-on-surface-variant">%</span>
                  {canEdit && (
                    <button type="submit" disabled={pending} className="ft-btn-ghost p-1.5 rounded-full" aria-label={`Save margin for ${d}`}>
                      <Icon name="check" className="text-[18px]" />
                    </button>
                  )}
                </form>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
