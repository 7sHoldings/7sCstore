"use client";

import { useState } from "react";
import { Icon } from "@/components/ui";

type Tree = Record<string, string[]>;
type Row = { parent: string; sub: string; amount: number };

const ROWS = 5;

/**
 * Two-level cash-payout editor: pick a category (parent) → a sub-category, then
 * an amount. Both levels can grow inline ("+ Add category" / "+ Add new…") and
 * persist server-side. Submits parallel `payoutParent` / `payoutSub` /
 * `payoutAmount` fields; the server combines them into "Parent · Sub".
 */
export default function PayoutTreeEditor({
  tree: initialTree,
  rows,
  addParentAction,
  addSubAction,
}: {
  tree: Tree;
  rows: Row[];
  addParentAction: (name: string) => Promise<Tree>;
  addSubAction: (parent: string, name: string) => Promise<Tree>;
}) {
  const [tree, setTree] = useState<Tree>(initialTree);
  const [state, setState] = useState(() =>
    Array.from({ length: ROWS }, (_, i) => ({ parent: rows[i]?.parent ?? "", sub: rows[i]?.sub ?? "" }))
  );
  const [addingParent, setAddingParent] = useState(false);
  const [newParent, setNewParent] = useState("");
  const [subAddRow, setSubAddRow] = useState<number | null>(null);
  const [newSub, setNewSub] = useState("");
  const [busy, setBusy] = useState(false);

  const parents = Array.from(new Set([...Object.keys(tree), ...state.map((r) => r.parent).filter(Boolean)]));
  const subsFor = (parent: string, current: string) =>
    Array.from(new Set([...(tree[parent] ?? []), ...(current ? [current] : [])]));

  const setRow = (i: number, patch: Partial<{ parent: string; sub: string }>) =>
    setState((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function addParent() {
    const n = newParent.trim();
    if (!n || busy) return;
    setBusy(true);
    try { setTree(await addParentAction(n)); setNewParent(""); setAddingParent(false); } finally { setBusy(false); }
  }
  async function addSub(i: number) {
    const parent = state[i].parent, n = newSub.trim();
    if (!parent || !n || busy) return;
    setBusy(true);
    try { setTree(await addSubAction(parent, n)); setRow(i, { sub: n }); setNewSub(""); setSubAddRow(null); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="ft-label">Payout in Cash</span>
        <button type="button" onClick={() => setAddingParent((v) => !v)} className="text-primary text-body-sm font-medium inline-flex items-center gap-1">
          <Icon name="add" className="text-[16px]" /> Add category
        </button>
      </div>
      {addingParent && (
        <div className="flex items-center gap-2 mb-2">
          <input
            value={newParent}
            onChange={(e) => setNewParent(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addParent(); } }}
            className="ft-input flex-1"
            placeholder="New category (e.g. Product Buying)"
            autoFocus
          />
          <button type="button" onClick={addParent} disabled={busy} className="ft-btn-primary py-1.5 px-3 text-body-sm disabled:opacity-50">Add</button>
        </div>
      )}

      <div className="space-y-2">
        {Array.from({ length: ROWS }).map((_, i) => {
          const r = state[i];
          return (
            <div key={i}>
              <div className="grid grid-cols-3 gap-2">
                <select name="payoutParent" value={r.parent} onChange={(e) => setRow(i, { parent: e.target.value, sub: "" })} className="ft-input">
                  <option value="">— Category —</option>
                  {parents.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select
                  name="payoutSub"
                  value={r.sub}
                  required={!!r.parent}
                  title={r.parent ? "Pick a sub-category" : undefined}
                  onChange={(e) => (e.target.value === "__add__" ? setSubAddRow(i) : setRow(i, { sub: e.target.value }))}
                  className="ft-input"
                >
                  <option value="">{r.parent ? "— Sub-category (required) —" : "—"}</option>
                  {subsFor(r.parent, r.sub).map((s) => <option key={s} value={s}>{s}</option>)}
                  {r.parent && <option value="__add__">+ Add new…</option>}
                </select>
                <input name="payoutAmount" type="number" step="0.01" min="0" defaultValue={rows[i]?.amount || ""} className="ft-input" placeholder="0.00" />
              </div>
              {subAddRow === i && (
                <div className="flex items-center gap-2 mt-1 pl-1">
                  <input
                    value={newSub}
                    onChange={(e) => setNewSub(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSub(i); } }}
                    className="ft-input flex-1"
                    placeholder={`New sub-category under "${r.parent}"`}
                    autoFocus
                  />
                  <button type="button" onClick={() => addSub(i)} disabled={busy} className="ft-btn-primary py-1.5 px-3 text-body-sm disabled:opacity-50">Add</button>
                  <button type="button" onClick={() => { setSubAddRow(null); setNewSub(""); }} className="ft-btn-ghost py-1.5 px-2 text-body-sm">Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
