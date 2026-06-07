"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { money } from "@/lib/calc";

const schema = z.object({
  name: z.string().min(1, "Vendor name is required."),
  contact: z.string().optional(),
  terms: z.string().optional(),
  balanceOwed: z.coerce.number().min(0).default(0),
});

export async function createVendor(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  try {
    const vendor = await prisma.vendor.create({
      data: { name: v.name, contact: v.contact, terms: v.terms, balanceOwed: money(v.balanceOwed) },
    });
    await logAudit({ userId: session.userId, action: "CREATE", entity: "Vendor", entityId: vendor.id, after: vendor });
  } catch (e) {
    console.error(e);
    return { error: "Could not create the vendor." };
  }
  revalidatePath("/vendors");
  return { ok: true };
}

export async function recordVendorPayment(id: string, amount: number): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "enterExpenses")) return;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) return;
  const newBalance = Math.max(0, money(vendor.balanceOwed - amount));
  await prisma.vendor.update({ where: { id }, data: { balanceOwed: newBalance } });
  await logAudit({
    userId: session.userId,
    action: "UPDATE",
    entity: "Vendor",
    entityId: id,
    before: { balanceOwed: vendor.balanceOwed },
    after: { balanceOwed: newBalance },
  });
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${id}`);
}

export async function deleteVendor(id: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "editDelete")) return;
  // Detach purchases first to preserve history.
  await prisma.purchase.updateMany({ where: { vendorId: id }, data: { vendorId: null } });
  const before = await prisma.vendor.findUnique({ where: { id } });
  await prisma.vendor.delete({ where: { id } });
  await logAudit({ userId: session.userId, action: "DELETE", entity: "Vendor", entityId: id, before });
  revalidatePath("/vendors");
}
