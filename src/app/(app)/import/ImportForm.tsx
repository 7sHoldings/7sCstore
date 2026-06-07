"use client";

import { useActionState } from "react";
import { importSales } from "./actions";
import { Card, Icon } from "@/components/ui";

export default function ImportForm() {
  const [state, action, pending] = useActionState(importSales, {});

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-md bg-surface-container flex items-center justify-center">
            <Icon name="upload_file" className="text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-on-surface">Import Sales (CSV)</h3>
            <p className="text-body-sm text-on-surface-variant">
              Columns: date, category, paymentType, amount, taxCollected, grade, gallons, pricePerGallon, note.
              Fuel rows use grade/gallons/pricePerGallon; other rows use amount.
            </p>
          </div>
        </div>

        <a href="/api/import/template" className="ft-btn-secondary mb-4 inline-flex">
          <Icon name="download" className="text-[18px]" /> Download CSV template
        </a>

        <form action={action} className="space-y-4">
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="block w-full text-body-md text-on-surface file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-on-primary file:font-semibold file:cursor-pointer cursor-pointer bg-surface-container-low border border-outline-variant rounded-md p-2"
          />
          <button type="submit" disabled={pending} className="ft-btn-primary">
            {pending ? "Validating & importing…" : "Validate & Import"}
            {!pending && <Icon name="arrow_forward" className="text-[18px]" />}
          </button>
        </form>
      </Card>

      {state?.error && (
        <Card className="p-4 border-error/40">
          <div className="flex items-center gap-2 text-error font-medium">
            <Icon name="error" className="text-[20px]" /> {state.error}
          </div>
        </Card>
      )}

      {state?.ok && (
        <Card className="p-4 border-secondary/40 bg-secondary-container/20">
          <div className="flex items-center gap-2 text-secondary font-medium">
            <Icon name="check_circle" className="text-[20px]" /> Imported {state.imported} sales successfully.
          </div>
        </Card>
      )}

      {state?.errors && state.errors.length > 0 && (
        <Card className="p-4">
          <h4 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
            <Icon name="rule" className="text-[20px] text-error" />
            Validation failed — nothing was imported ({state.errors.length} issues)
          </h4>
          <ul className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
            {state.errors.map((e, i) => (
              <li key={i} className="text-body-sm text-on-surface-variant flex gap-2">
                <span className="font-mono text-error">Row {e.row}</span> {e.message}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
