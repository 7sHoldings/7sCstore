"use client";

import { useActionState, useEffect, useState } from "react";
import { updateProduct } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";
import { fmtMoney } from "@/lib/format";
import { unitCostFromCase, marginOf } from "@/lib/pricing";

export type EditProduct = {
  id: string;
  name: string;
  sellingPrice: number;
  caseCost: number;
  unitsPerCase: number;
  marginPct: number | null;
  vendorId: string | null;
  qtyOnHand: number;
  lowThreshold: number | null;
  parLevel: number | null;
};

export default function EditProductButton({ product, vendors }: { product: EditProduct; vendors: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateProduct, {});
  const [caseCost, setCaseCost] = useState(String(product.caseCost || ""));
  const [units, setUnits] = useState(String(product.unitsPerCase || 1));
  const [price, setPrice] = useState(String(product.sellingPrice || ""));

  useEffect(() => { if (state?.ok) setOpen(false); }, [state?.ok]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ft-btn-ghost p-1.5 rounded-md" aria-label="Edit product" title="Edit">
        <Icon name="edit" className="text-[18px]" />
      </button>
    );
  }

  const unitCost = unitCostFromCase(Number(caseCost) || 0, Math.max(1, Number(units) || 1));
  const margin = marginOf(unitCost, Number(price) || 0);

  return (
    <Modal title={product.name} onClose={() => setOpen(false)}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="id" value={product.id} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="ep-price">Retail price</label>
            <input id="ep-price" name="sellingPrice" type="number" step="0.01" min="0" className="ft-input" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </div>
          <div>
            <label className="ft-label" htmlFor="ep-vendor">Vendor</label>
            <select id="ep-vendor" name="vendorId" className="ft-input" defaultValue={product.vendorId ?? ""}>
              <option value="">— none —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="ft-label" htmlFor="ep-case">Case cost</label>
            <input id="ep-case" name="caseCost" type="number" step="0.01" min="0" className="ft-input" value={caseCost} onChange={(e) => setCaseCost(e.target.value)} />
          </div>
          <div>
            <label className="ft-label" htmlFor="ep-units">Units / case</label>
            <input id="ep-units" name="unitsPerCase" type="number" step="1" min="1" className="ft-input" value={units} onChange={(e) => setUnits(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-container-low p-3 text-center">
          <Stat label="Unit cost" value={fmtMoney(unitCost)} />
          <Stat label="Retail" value={fmtMoney(Number(price) || 0)} />
          <Stat label="Margin" value={margin > 0 ? `${margin}%` : "—"} tone={margin > 0 ? "secondary" : undefined} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="ft-label" htmlFor="ep-qty">On hand</label>
            <input id="ep-qty" name="qtyOnHand" type="number" step="1" min="0" className="ft-input" defaultValue={product.qtyOnHand} />
          </div>
          <div>
            <label className="ft-label" htmlFor="ep-reorder">Reorder at</label>
            <input id="ep-reorder" name="lowThreshold" type="number" step="1" min="0" className="ft-input" defaultValue={product.lowThreshold ?? ""} placeholder="—" />
          </div>
          <div>
            <label className="ft-label" htmlFor="ep-par">Order up to</label>
            <input id="ep-par" name="parLevel" type="number" step="1" min="0" className="ft-input" defaultValue={product.parLevel ?? ""} placeholder="—" />
          </div>
        </div>

        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "secondary" }) {
  return (
    <div>
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className={`tabular text-base font-bold ${tone === "secondary" ? "text-secondary" : "text-on-surface"}`}>{value}</div>
    </div>
  );
}
