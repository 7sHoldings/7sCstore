"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPurchase, createFuelDelivery } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";
import { gradeLabel } from "@/lib/format";

const GRADES = ["REGULAR", "MID", "PREMIUM", "DIESEL"];

export function PurchaseForm({
  defaultDate,
  vendors,
}: {
  defaultDate: string;
  vendors: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createPurchase, {});
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
        <Icon name="add" className="text-[18px]" /> New Purchase
      </button>
    );
  }

  return (
    <Modal title="Record a Purchase" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="p-date">Date</label>
            <input id="p-date" name="date" type="date" defaultValue={defaultDate} className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="vendorId">Vendor</label>
            <select id="vendorId" name="vendorId" className="ft-input" defaultValue="">
              <option value="">— none —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="ft-label" htmlFor="productName">Product</label>
            <input id="productName" name="productName" type="text" className="ft-input" placeholder="e.g. Coca-Cola 20oz" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="invoiceNo">Invoice #</label>
            <input id="invoiceNo" name="invoiceNo" type="text" className="ft-input" placeholder="optional" />
          </div>
          <div>
            <label className="ft-label" htmlFor="qty">Quantity</label>
            <input id="qty" name="qty" type="number" step="0.01" min="0" className="ft-input" placeholder="0" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="costEach">Cost each</label>
            <input id="costEach" name="costEach" type="number" step="0.01" min="0" className="ft-input" placeholder="0.00" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="sellPrice">Selling price</label>
            <input id="sellPrice" name="sellPrice" type="number" step="0.01" min="0" className="ft-input" placeholder="0.00" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-body-md text-on-surface">
          <input type="checkbox" name="paid" className="w-4 h-4 accent-[#0a2540]" /> Already paid
        </label>

        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Save purchase"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function FuelDeliveryForm({
  defaultDate,
  vendors,
}: {
  defaultDate: string;
  vendors: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createFuelDelivery, {});
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
        <Icon name="local_shipping" className="text-[18px]" /> Fuel Delivery
      </button>
    );
  }

  return (
    <Modal title="Record a Fuel Delivery" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="d-date">Date</label>
            <input id="d-date" name="date" type="date" defaultValue={defaultDate} className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="d-vendor">Vendor</label>
            <select id="d-vendor" name="vendorId" className="ft-input" defaultValue="">
              <option value="">— none —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="ft-label" htmlFor="grade">Grade</label>
            <select id="grade" name="grade" className="ft-input" defaultValue="REGULAR">
              {GRADES.map((g) => (
                <option key={g} value={g}>{gradeLabel(g)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="ft-label" htmlFor="gallons">Gallons received</label>
            <input id="gallons" name="gallons" type="number" step="0.01" min="0" className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="costPerGallon">Cost / gal</label>
            <input id="costPerGallon" name="costPerGallon" type="number" step="0.0001" min="0" className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="taxPerGallon">Tax / gal</label>
            <input id="taxPerGallon" name="taxPerGallon" type="number" step="0.0001" min="0" defaultValue="0.184" className="ft-input" />
          </div>
          <div className="col-span-2">
            <label className="ft-label" htmlFor="d-invoice">Invoice #</label>
            <input id="d-invoice" name="invoiceNo" type="text" className="ft-input" placeholder="optional" />
          </div>
        </div>

        {state?.error && (
          <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {state.error}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Save delivery"}</button>
        </div>
      </form>
    </Modal>
  );
}
