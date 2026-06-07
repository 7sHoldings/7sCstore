"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { money } from "@/lib/calc";

const employeeSchema = z.object({
  name: z.string().min(1, "Name is required."),
  position: z.string().optional(),
  hourlyRate: z.coerce.number().min(0).default(0),
});

export async function createEmployee(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "viewAll")) return { error: "You don't have permission." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  try {
    const emp = await prisma.employee.create({
      data: { locationId, name: v.name, position: v.position, hourlyRate: money(v.hourlyRate) },
    });
    await logAudit({ userId: session.userId, action: "CREATE", entity: "Employee", entityId: emp.id, after: emp });
  } catch (e) {
    console.error(e);
    return { error: "Could not add the employee." };
  }
  revalidatePath("/payroll");
  return { ok: true };
}

const payrollSchema = z.object({
  employeeId: z.string().min(1, "Choose an employee."),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  hours: z.coerce.number().min(0).default(0),
  grossPay: z.coerce.number().min(0).default(0),
  note: z.string().optional(),
});

export async function createPayrollEntry(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "viewAll")) return { error: "You don't have permission." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const parsed = payrollSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  // Default gross pay from hours × rate if not provided.
  let gross = v.grossPay;
  if (!gross) {
    const emp = await prisma.employee.findUnique({ where: { id: v.employeeId } });
    gross = money(v.hours * (emp?.hourlyRate ?? 0));
  }

  try {
    const entry = await prisma.payrollEntry.create({
      data: {
        locationId,
        employeeId: v.employeeId,
        periodStart: new Date(v.periodStart),
        periodEnd: new Date(v.periodEnd),
        hours: v.hours,
        grossPay: money(gross),
        note: v.note,
      },
    });
    await logAudit({ userId: session.userId, action: "CREATE", entity: "PayrollEntry", entityId: entry.id, after: entry });
  } catch (e) {
    console.error(e);
    return { error: "Could not save the payroll entry." };
  }
  revalidatePath("/payroll");
  return { ok: true };
}

export async function deletePayrollEntry(id: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "editDelete")) return;
  await prisma.payrollEntry.delete({ where: { id } });
  await logAudit({ userId: session.userId, action: "DELETE", entity: "PayrollEntry", entityId: id });
  revalidatePath("/payroll");
}
