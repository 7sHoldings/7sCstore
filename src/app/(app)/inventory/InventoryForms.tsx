"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { recordFuelReading, createProduct } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";
import { gradeLabel, catLabel, fmtMoney } from "@/lib/format";
import { unitCostFromCase, priceFromMargin, defaultMargin, marginOf } from "@/lib/pricing";

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

export function ProductForm({ vendors }: { vendors: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createProduct, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Live pricing preview.
  const [category, setCategory] = useState("STORE");
  const [caseCost, setCaseCost] = useState("");
  const [unitsPerCase, setUnitsPerCase] = useState("1");
  const [margin, setMargin] = useState("");
  const [priceOverride, setPriceOverride] = useState("");

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setCategory("STORE"); setCaseCost(""); setUnitsPerCase("1"); setMargin(""); setPriceOverride("");
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

  const cc = Number(caseCost) || 0;
  const upc = Math.max(1, Number(unitsPerCase) || 1);
  const unitCost = unitCostFromCase(cc, upc);
  const effMargin = margin === "" ? defaultMargin(category) : Number(margin) || 0;
  const autoPrice = priceFromMargin(unitCost, effMargin);
  const price = Number(priceOverride) > 0 ? Number(priceOverride) : autoPrice;
  const realMargin = marginOf(unitCost, price);

  return (
    <Modal title="Add a Product" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="ft-label" htmlFor="pr-name">Product name</label>
            <input id="pr-name" name="name" type="text" className="ft-input" placeholder="e.g. Snickers Bar" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="pr-cat">Category</label>
            <select id="pr-cat" name="category" className="ft-input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="ft-label" htmlFor="pr-vendor">Vendor</label>
            <select id="pr-vendor" name="vendorId" className="ft-input" defaultValue="">
              <option value="">— none —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="ft-label" htmlFor="caseCost">Case cost (wholesale)</label>
            <input id="caseCost" name="caseCost" type="number" step="0.01" min="0" className="ft-input" placeholder="10.00" value={caseCost} onChange={(e) => setCaseCost(e.target.value)} />
          </div>
          <div>
            <label className="ft-label" htmlFor="unitsPerCase">Units per case</label>
            <input id="unitsPerCase" name="unitsPerCase" type="number" step="1" min="1" className="ft-input" placeholder="10" value={unitsPerCase} onChange={(e) => setUnitsPerCase(e.target.value)} />
          </div>
          <div>
            <label className="ft-label" htmlFor="marginPct">Margin % <span className="text-on-surface-variant font-normal">(blank = {defaultMargin(category)}%)</span></label>
            <input id="marginPct" name="marginPct" type="number" step="0.1" min="0" max="95" className="ft-input" placeholder={String(defaultMargin(category))} value={margin} onChange={(e) => setMargin(e.target.value)} />
          </div>
          <div>
            <label className="ft-label" htmlFor="sellingPrice">Retail price <span className="text-on-surface-variant font-normal">(override)</span></label>
            <input id="sellingPrice" name="sellingPrice" type="number" step="0.01" min="0" className="ft-input" placeholder={fmtMoney(autoPrice)} value={priceOverride} onChange={(e) => setPriceOverride(e.target.value)} />
          </div>
        </div>

        {/* Live pricing preview */}
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-container-low p-3 text-center">
          <Stat label="Unit cost" value={fmtMoney(unitCost)} />
          <Stat label="Retail / unit" value={fmtMoney(price)} tone="primary" />
          <Stat label="Margin" value={`${realMargin}%`} tone={realMargin > 0 ? "secondary" : undefined} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="ft-label" htmlFor="qtyOnHand">On hand (units)</label>
            <input id="qtyOnHand" name="qtyOnHand" type="number" step="1" min="0" defaultValue="0" className="ft-input" />
          </div>
          <div>
            <label className="ft-label" htmlFor="lowThreshold">Reorder at</label>
            <input id="lowThreshold" name="lowThreshold" type="number" step="1" min="0" className="ft-input" placeholder="warning #" />
          </div>
          <div>
            <label className="ft-label" htmlFor="parLevel">Order up to</label>
            <input id="parLevel" name="parLevel" type="number" step="1" min="0" className="ft-input" placeholder="par level" />
          </div>
        </div>
        <div>
          <label className="ft-label" htmlFor="upc">UPC / barcode (optional)</label>
          <input id="upc" name="upc" type="text" className="ft-input" placeholder="scan or type" />
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "primary" | "secondary" }) {
  const cls = tone === "primary" ? "text-primary" : tone === "secondary" ? "text-secondary" : "text-on-surface";
  return (
    <div>
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className={`tabular text-lg font-bold ${cls}`}>{value}</div>
    </div>
  );
}
