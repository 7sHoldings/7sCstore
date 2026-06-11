"use client";

import { useState } from "react";
import { gallonsForInches } from "@/lib/tankChart";
import { Icon } from "@/components/ui";
import { saveTankReading } from "./actions";

const GRADES: [string, string][] = [["REGULAR", "Regular"], ["PREMIUM", "Premium"], ["DIESEL", "Diesel"]];

/** Stick-reading entry with live inches→gallons conversion. */
export default function TankReadingForm({ defaultDate }: { defaultDate: string }) {
  const [vals, setVals] = useState<Record<string, string>>({ REGULAR: "", PREMIUM: "", DIESEL: "" });

  return (
    <form action={saveTankReading} className="space-y-4">
      <div className="max-w-xs">
        <label className="ft-label" htmlFor="date">Reading date</label>
        <input id="date" name="date" type="date" defaultValue={defaultDate} className="ft-input w-full" />
      </div>

      <div className="space-y-3">
        {GRADES.map(([g, label]) => {
          const inches = parseFloat(vals[g]);
          const gal = isFinite(inches) ? gallonsForInches(inches) : 0;
          return (
            <div key={g} className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <div>
                <label className="ft-label">{label} — stick reading (inches)</label>
                <input
                  name={`inches_${g}`}
                  type="number"
                  step="0.01"
                  min="0"
                  value={vals[g]}
                  onChange={(e) => setVals((v) => ({ ...v, [g]: e.target.value }))}
                  className="ft-input w-full"
                  placeholder="0.00"
                />
              </div>
              <div className="rounded-md bg-surface-container-low px-3 py-2">
                <div className="text-label-caps uppercase text-on-surface-variant">{label} gallons</div>
                <div className="tabular font-bold text-base">{gal ? gal.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</div>
              </div>
            </div>
          );
        })}
      </div>

      <button type="submit" className="ft-btn-primary"><Icon name="save" className="text-[18px]" /> Save readings</button>
    </form>
  );
}
