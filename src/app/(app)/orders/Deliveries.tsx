"use client";

import { useState } from "react";
import { Card, Icon, Badge } from "@/components/ui";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/format";
import { setOrderDate, spaceOrderDatesWeekly } from "./actions";

export interface DeliveryRow {
  orderId: string;
  orderedAt: string | null;
  lines: number;
  units: number;
  total: number;
}

/**
 * The uploaded vendor orders, which are the record of what reached the shelves.
 * Dates matter here: shelf stock is deliveries minus sales, and those only
 * subtract meaningfully when both describe the same stretch of time.
 */
export default function Deliveries({
  deliveries,
  canEdit,
  historyDays,
}: {
  deliveries: DeliveryRow[];
  canEdit: boolean;
  historyDays: number;
}) {
  const [open, setOpen] = useState(false);
  const dated = deliveries.filter((d) => d.orderedAt).length;
  const undated = deliveries.length - dated;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card className="mb-6 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-surface-container-low/50 text-left"
      >
        <span className="flex items-center gap-2 font-semibold text-on-surface">
          <Icon name="local_shipping" className="text-[20px] text-primary" />
          Deliveries on file
          <Badge tone={undated > 0 ? "warning" : "success"}>
            {dated} of {deliveries.length} dated
          </Badge>
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} className="text-on-surface-variant" />
      </button>

      {open && (
        <div className="border-t border-outline-variant/60 p-4">
          <p className="text-body-sm text-on-surface-variant mb-3">
            Each uploaded order is stock that reached the shelves. Shelf stock is worked out
            as <strong>delivered minus sold</strong> over the last {historyDays} days, so an
            order only counts once it has a date.
          </p>

          {canEdit && undated > 0 && (
            <form
              action={spaceOrderDatesWeekly}
              className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-surface-container-low rounded-md"
            >
              <div>
                <label className="text-label-caps uppercase text-on-surface-variant block mb-1" htmlFor="newest">
                  Newest delivery arrived
                </label>
                <input
                  id="newest"
                  name="newest"
                  type="date"
                  defaultValue={today}
                  className="ft-input py-1.5 text-body-sm"
                />
              </div>
              <button type="submit" className="ft-btn-secondary py-1.5">
                Date the other {undated} weekly
              </button>
              <span className="text-body-sm text-on-surface-variant">
                Steps back a week per order. Dates already set are left alone.
              </span>
            </form>
          )}

          <div className="overflow-x-auto custom-scrollbar max-h-80">
            <table className="w-full text-left text-body-sm">
              <thead className="sticky top-0">
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Delivered</th>
                  <th className="px-3 py-2 text-right">Lines</th>
                  <th className="px-3 py-2 text-right">Units</th>
                  <th className="px-3 py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {deliveries.map((d) => (
                  <tr key={d.orderId} className="hover:bg-surface-container-low/50">
                    <td className="px-3 py-2 tabular font-medium text-on-surface">#{d.orderId}</td>
                    <td className="px-3 py-2">
                      {canEdit ? (
                        <form action={setOrderDate} className="flex items-center gap-1.5">
                          <input type="hidden" name="orderId" value={d.orderId} readOnly />
                          <input
                            name="orderedAt"
                            type="date"
                            defaultValue={d.orderedAt ? d.orderedAt.slice(0, 10) : ""}
                            className="ft-input py-1 text-body-sm w-40"
                          />
                          <button type="submit" className="ft-btn-ghost p-1 rounded-full" aria-label={`Save date for order ${d.orderId}`}>
                            <Icon name="check" className="text-[16px]" />
                          </button>
                        </form>
                      ) : d.orderedAt ? (
                        fmtDate(d.orderedAt)
                      ) : (
                        <span className="text-tertiary">no date</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-on-surface-variant">{fmtNumber(d.lines)}</td>
                    <td className="px-3 py-2 text-right tabular text-on-surface-variant">{fmtNumber(d.units)}</td>
                    <td className="px-3 py-2 text-right tabular">{fmtMoney(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
