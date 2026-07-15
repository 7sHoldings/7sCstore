"use client";

import { useEffect, useMemo, useState } from "react";
import { addExpenseOption } from "./actions";

const ADD = "__add_new__";

// A <select> whose last entry is "+ Add new…". Choosing it reveals an inline
// input; the typed value is saved to the DB (so it persists) and is appended to
// the list and selected. The chosen value is submitted via a hidden input so it
// drops into the surrounding form unchanged.
//
// The visible options are always derived from the `options`/`kind` props, so
// switching the category (Store Operating Expenses ↔ Inventory Purchase)
// immediately swaps the list — no stale entries from the previous category.
export default function OptionSelect({
  name,
  options,
  kind,
  placeholder,
  initial,
}: {
  name: string;
  options: readonly string[];
  kind: "EXPENSE_TYPE" | "VENDOR";
  placeholder: string;
  initial?: string;
}) {
  const [added, setAdded] = useState<string[]>([]);
  const [value, setValue] = useState(initial ?? "");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");

  const opts = useMemo(() => {
    const seen = new Set(options.map((o) => o.toLowerCase()));
    const out = [...options];
    for (const extra of [...added, ...(initial ? [initial] : [])]) {
      if (extra && !seen.has(extra.toLowerCase())) {
        seen.add(extra.toLowerCase());
        out.push(extra);
      }
    }
    return out;
  }, [options, added, initial]);

  // When the list itself changes (category switch), drop a selection that no
  // longer belongs to it so a Store-Operating type can't ride into Inventory.
  useEffect(() => {
    setValue((v) => (v && !opts.some((o) => o === v) ? "" : v));
  }, [opts]);

  async function commitNew() {
    const v = draft.trim();
    if (!v) { setErr("Enter a name."); return; }
    // Already in the list (case-insensitive)? Just select it.
    const existing = opts.find((o) => o.toLowerCase() === v.toLowerCase());
    if (existing) { setValue(existing); setAdding(false); setDraft(""); setErr(""); return; }

    setPending(true); setErr("");
    const res = await addExpenseOption(kind, v);
    setPending(false);
    if (res?.error) { setErr(res.error); return; }
    const addedValue = res?.value ?? v;
    setAdded((prev) => [...prev, addedValue]);
    setValue(addedValue);
    setAdding(false);
    setDraft("");
  }

  function cancelAdd() {
    setAdding(false);
    setDraft("");
    setErr("");
  }

  if (adding) {
    return (
      <div>
        <div className="flex gap-1">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitNew(); }
              if (e.key === "Escape") { e.preventDefault(); cancelAdd(); }
            }}
            className="ft-input"
            placeholder={kind === "VENDOR" ? "New vendor name…" : "New expense type…"}
          />
          <button type="button" onClick={commitNew} disabled={pending} className="ft-btn-primary px-3 whitespace-nowrap">
            {pending ? "…" : "Add"}
          </button>
          <button type="button" onClick={cancelAdd} className="ft-btn-secondary px-2" aria-label="Cancel">✕</button>
        </div>
        {err && <div className="text-error text-body-sm mt-1">{err}</div>}
        <input type="hidden" name={name} value="" />
      </div>
    );
  }

  return (
    <>
      <select
        className="ft-input"
        value={value}
        onChange={(e) => {
          if (e.target.value === ADD) { setErr(""); setAdding(true); return; }
          setValue(e.target.value);
        }}
      >
        <option value="" disabled>{placeholder}</option>
        {opts.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
        <option value={ADD}>+ Add new…</option>
      </select>
      <input type="hidden" name={name} value={value} />
    </>
  );
}
