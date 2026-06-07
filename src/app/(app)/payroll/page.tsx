import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtMoney, fmtDate, fmtNumber } from "@/lib/format";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import { EmployeeForm, PayrollEntryForm } from "./PayrollForms";
import DeleteButton from "@/components/DeleteButton";
import { deletePayrollEntry } from "./actions";
import { startOfMonth, toISODate } from "@/lib/period";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const session = (await getSession())!;
  if (!can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Your role can't view payroll." /></Card>;
  }
  const loc = await getActiveLocationId();

  const [employees, entries] = await Promise.all([
    prisma.employee.findMany({ where: { active: true, ...(loc ? { locationId: loc } : {}) }, orderBy: { name: "asc" } }),
    prisma.payrollEntry.findMany({
      where: loc ? { locationId: loc } : {},
      include: { employee: true },
      orderBy: { periodStart: "desc" },
      take: 200,
    }),
  ]);

  const totalPay = entries.reduce((s, e) => s + e.grossPay, 0);
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const canDelete = can(session.role, "editDelete");
  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Payroll Tracking"
        subtitle="Record staff hours and wages (tracking only — not payroll processing)"
        actions={
          <div className="flex gap-2">
            <EmployeeForm />
            <PayrollEntryForm
              employees={employees.map((e) => ({ id: e.id, name: e.name, hourlyRate: e.hourlyRate }))}
              defaultStart={toISODate(startOfMonth(now))}
              defaultEnd={toISODate(now)}
            />
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Tile label="Employees" value={String(employees.length)} />
        <Tile label="Total Hours" value={fmtNumber(totalHours)} />
        <Tile label="Total Wages" value={fmtMoney(totalPay)} />
      </div>

      <Card className="overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">Payroll Entries</div>
        {entries.length === 0 ? (
          <EmptyState icon="badge" title="No payroll entries" hint="Add an employee, then record a pay period." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3 text-right">Hours</th>
                  <th className="px-4 py-3 text-right">Gross Pay</th>
                  {canDelete && <th></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 font-medium text-on-surface">{e.employee.name}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{fmtDate(e.periodStart)} – {fmtDate(e.periodEnd)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtNumber(e.hours)}</td>
                    <td className="px-4 py-3 text-right tabular font-semibold">{fmtMoney(e.grossPay)}</td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <DeleteButton id={e.id} action={deletePayrollEntry} label="Delete this payroll entry?" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">Employees</div>
        {employees.length === 0 ? (
          <EmptyState icon="group" title="No employees yet" />
        ) : (
          <ul className="divide-y divide-outline-variant/40">
            {employees.map((e) => (
              <li key={e.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium text-on-surface">{e.name}</div>
                  <div className="text-body-sm text-on-surface-variant">{e.position || "—"}</div>
                </div>
                <Badge tone="neutral">{fmtMoney(e.hourlyRate)}/hr</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className="tabular text-lg font-bold text-on-surface mt-1">{value}</div>
    </Card>
  );
}
