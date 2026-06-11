"use client";

import { useState } from "react";
import { Icon } from "@/components/ui";

const ROWS = 5;

/**
 * A set of category+amount rows (e.g. payouts or house charges) whose dropdown
 * can grow: "+ Add category" inserts a new option inline (persisted server-side)
 * without leaving the form.
 */
export default function LineItemEditor({
  title, selectName, amountName, initialOptions, rows, addAction,
}: {
  title: string;
  selectName: string;
  amountName: string;
  initialOptions: string[];
  rows: { account: string; amount: number }[];
  addAction: (name: string) => Promise<string[]>;
}) {
  const [options, setOptions] = useState(initialOptions);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  async function doAdd() {
    const n = newName.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const updated = await addAction(n);
      setOptions(updated);
      setNewName("");
      setAdding(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="ft-label">{title}</span>
        <button type="button" onClick={() => setAdding((v) => !v)} className="text-primary text-body-sm font-medium inline-flex items-center gap-1">
          <Icon name="add" className="text-[16px]" /> Add category
        </button>
      </div>
      {adding && (
        <div className="flex items-center gap-2 mb-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } }}
            className="ft-input flex-1"
            placeholder="New category name"
            autoFocus
          />
          <button type="button" onClick={doAdd} disabled={busy} className="ft-btn-primary py-1.5 px-3 text-body-sm disabled:opacity-50">Add</button>
        </div>
      )}
      <div className="space-y-2">
        {Array.from({ length: ROWS }).map((_, i) => {
          const row = rows[i];
          return (
            <div key={i} className="grid grid-cols-2 gap-2">
              <select name={selectName} defaultValue={row?.account ?? ""} className="ft-input">
                <option value="">— Select —</option>
                {options.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <input name={amountName} type="number" step="0.01" min="0" defaultValue={row?.amount ?? ""} className="ft-input" placeholder="0.00" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
