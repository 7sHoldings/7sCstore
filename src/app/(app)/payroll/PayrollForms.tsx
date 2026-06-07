"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createEmployee, createPayrollEntry } from "./actions";
import { Icon } from "@/components/ui";
import Modal from "@/components/Modal";

export function EmployeeForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createEmployee, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) { formRef.current?.reset(); setOpen(false); }
  }, [state?.ok]);

  if (!open) {
    return <button className="ft-btn-secondary" onClick={() => setOpen(true)}><Icon name="person_add" className="text-[18px]" /> Employee</button>;
  }
  return (
    <Modal title="Add an Employee" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div>
          <label className="ft-label" htmlFor="e-name">Name</label>
          <input id="e-name" name="name" type="text" className="ft-input" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="position">Position</label>
            <input id="position" name="position" type="text" className="ft-input" placeholder="e.g. Cashier" />
          </div>
          <div>
            <label className="ft-label" htmlFor="hourlyRate">Hourly rate</label>
            <input id="hourlyRate" name="hourlyRate" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" />
          </div>
        </div>
        {state?.error && <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md"><Icon name="error" className="text-[18px]" /> {state.error}</div>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Add employee"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function PayrollEntryForm({
  employees,
  defaultStart,
  defaultEnd,
}: {
  employees: { id: string; name: string; hourlyRate: number }[];
  defaultStart: string;
  defaultEnd: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createPayrollEntry, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [empId, setEmpId] = useState(employees[0]?.id ?? "");
  const [hours, setHours] = useState(0);
  const rate = employees.find((e) => e.id === empId)?.hourlyRate ?? 0;
  const computed = (hours * rate).toFixed(2);

  useEffect(() => {
    if (state?.ok) { formRef.current?.reset(); setHours(0); setOpen(false); }
  }, [state?.ok]);

  if (!open) {
    return (
      <button className="ft-btn-primary" onClick={() => setOpen(true)} disabled={employees.length === 0}>
        <Icon name="add" className="text-[18px]" /> Payroll Entry
      </button>
    );
  }
  return (
    <Modal title="Record Payroll" onClose={() => setOpen(false)}>
      <form ref={formRef} action={action} className="space-y-4">
        <div>
          <label className="ft-label" htmlFor="employeeId">Employee</label>
          <select id="employeeId" name="employeeId" className="ft-input" value={empId} onChange={(e) => setEmpId(e.target.value)} required>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name} (${e.hourlyRate}/hr)</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ft-label" htmlFor="periodStart">Period start</label>
            <input id="periodStart" name="periodStart" type="date" defaultValue={defaultStart} className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="periodEnd">Period end</label>
            <input id="periodEnd" name="periodEnd" type="date" defaultValue={defaultEnd} className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="hours">Hours</label>
            <input id="hours" name="hours" type="number" step="0.01" min="0" defaultValue="0" className="ft-input" onChange={(e) => setHours(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className="ft-label" htmlFor="grossPay">Gross pay</label>
            <input id="grossPay" name="grossPay" type="number" step="0.01" min="0" className="ft-input" placeholder={`auto: ${computed}`} />
          </div>
        </div>
        <p className="text-body-sm text-on-surface-variant">Leave gross pay blank to use hours × rate (${computed}).</p>
        <div>
          <label className="ft-label" htmlFor="p-note">Note</label>
          <input id="p-note" name="note" type="text" className="ft-input" placeholder="optional" />
        </div>
        {state?.error && <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md"><Icon name="error" className="text-[18px]" /> {state.error}</div>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setOpen(false)} className="ft-btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={pending} className="ft-btn-primary flex-1 justify-center">{pending ? "Saving…" : "Save entry"}</button>
        </div>
      </form>
    </Modal>
  );
}
