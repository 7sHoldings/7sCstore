"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { recordFuelReading, createProduct } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";
import { gradeLabel, catLabel } from "@/lib/format";

const GRADES = ["REGULAR", "MID", "PREMIUM", "DIESEL"];
const CATEGORIES = ["STORE", "FOOD_DRINK", "TOBACCO", "LOTTERY", "OTHER"];

export function FuelReadingForm({ defaultDate }: { defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordFuelReading, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state?.ok]);

  if (!open) {
    return (
      <button className="ft-btn-secondary" onClick={() => setOpen(true)}>
        <Icon name="gas_meter" className="text-[18px]" /> Tank Reading
      </button>
    );
  }

  return (
    <Modal title="Record Tank Reading" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="r-date">Date</label>
            <input id="r-date" name="date" type="date" defaultValue={defaultDate} className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="r-grade">Grade</label>
            <select id="r-grade" name="grade" className="ft-input" defaultValue="REGULAR">
              {GRADES.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
            </select>
          </div>
          <div>
            <label className="ft-label" htmlFor="gallonsBook">Book gallons</label>
            <input id="gallonsBook" name="gallonsBook" type="number" step="0.01" min="0" className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="gallonsPhysical">Physical (dip) gallons</label>
            <input id="gallonsPhysical" name="gallonsPhysical" type="number" step="0.01" min="0" className="ft-input" required />
          </div>
        </div>
        <p className="text-body-sm text-on-surface-variant">Variance (physical − book) is calculated automatically.</p>

        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Save reading"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ProductForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createProduct, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state?.ok]);

  if (!open) {
    return (
      <button className="ft-btn-primary" onClick={() => setOpen(true)}>
        <Icon name="add" className="text-[18px]" /> New Product
      </button>
    );
  }

  return (
    <Modal title="Add a Product" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div>
          <label className="ft-label" htmlFor="pr-name">Product name</label>
          <input id="pr-name" name="name" type="text" className="ft-input" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="pr-cat">Category</label>
            <select id="pr-cat" name="category" className="ft-input" defaultValue="STORE">
              {CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="ft-label" htmlFor="qtyOnHand">Qty on hand</label>
            <input id="qtyOnHand" name="qtyOnHand" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" />
          </div>
          <div>
            <label className="ft-label" htmlFor="currentCost">Unit cost</label>
            <input id="currentCost" name="currentCost" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" />
          </div>
          <div>
            <label className="ft-label" htmlFor="sellingPrice">Selling price</label>
            <input id="sellingPrice" name="sellingPrice" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" />
          </div>
          <div className="col-span-2">
            <label className="ft-label" htmlFor="lowThreshold">Low-stock threshold (optional)</label>
            <input id="lowThreshold" name="lowThreshold" type="number" step="0.01" min="0" className="ft-input" placeholder="e.g. 10" />
          </div>
        </div>

        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Add product"}</button>
        </div>
      </form>
    </Modal>
  );
}
