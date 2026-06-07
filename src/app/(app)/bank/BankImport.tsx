"use client";

import { useActionState } from "react";
import { importBank } from "./actions";
import { Card, Icon } from "@/components/ui";

export default function BankImport() {
  const [state, action, pending] = useActionState(importBank, {});

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-md bg-surface-container flex items-center justify-center">
            <Icon name="account_balance" className="text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-on-surface">Import Bank Statement (CSV)</h3>
            <p className="text-body-sm text-on-surface-variant">
              Columns: <span className="font-mono">date, description, amount</span>. Negative amounts are
              treated as debits (money out) and auto-matched to expenses of the same amount within ±4 days.
            </p>
          </div>
        </div>

        <form action={action} className="space-y-4">
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="block w-full text-body-md text-on-surface file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-on-primary file:font-semibold file:cursor-pointer cursor-pointer bg-surface-container-low border border-outline-variant rounded-md p-2"
          />
          <button type="submit" disabled={pending} className="ft-btn-primary">
            {pending ? "Importing…" : "Import & Match"}
            {!pending && <Icon name="arrow_forward" className="text-[18px]" />}
          </button>
        </form>
      </Card>

      {state?.error && (
        <Card className="p-4 border-error/40">
          <div className="flex items-center gap-2 text-error font-medium"><Icon name="error" className="text-[20px]" /> {state.error}</div>
        </Card>
      )}
      {state?.ok && (
        <Card className="p-4 bg-secondary-container/20">
          <div className="flex items-center gap-2 text-secondary font-medium">
            <Icon name="check_circle" className="text-[20px]" /> Imported {state.imported} transactions — {state.matched} auto-matched to expenses.
          </div>
        </Card>
      )}
      {state?.errors && state.errors.length > 0 && (
        <Card className="p-4">
          <h4 className="font-semibold text-on-surface mb-2">Validation failed — nothing imported</h4>
          <ul className="space-y-1 max-h-56 overflow-y-auto custom-scrollbar">
            {state.errors.map((e, i) => (
              <li key={i} className="text-body-sm text-on-surface-variant"><span className="font-mono text-error">Row {e.row}</span> {e.message}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
