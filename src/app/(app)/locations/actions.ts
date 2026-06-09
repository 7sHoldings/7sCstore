"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { setSetting } from "@/lib/settings";

const schema = z.object({
  name: z.string().min(1, "Location name is required."),
  address: z.string().optional(),
});

/** Save the store sales-tax rate (percent) used for estimated tax. */
export async function setTaxRate(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "manageUsers")) return;
  const rate = Number(formData.get("taxRate"));
  if (!isFinite(rate) || rate < 0 || rate > 100) return;
  await setSetting("taxRate", String(rate));
  await logAudit({ userId: session.userId, action: "UPDATE", entity: "Setting", entityId: "taxRate", after: { taxRate: rate } });
  revalidatePath("/locations");
  revalidatePath("/daily");
  revalidatePath("/dashboard");
}

export async function createLocation(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "manageUsers")) return { error: "Only owners can manage locations." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const loc = await prisma.location.create({ data: { name: parsed.data.name, address: parsed.data.address } });
    await logAudit({ userId: session.userId, action: "CREATE", entity: "Location", entityId: loc.id, after: loc });
  } catch (e) {
    console.error(e);
    return { error: "Could not create the location." };
  }
  revalidatePath("/locations");
  return { ok: true };
}

/** Switch the active location for the current viewer (owners/managers). */
export async function switchLocation(id: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "viewAll")) return;
  const exists = await prisma.location.findUnique({ where: { id } });
  if (!exists) return;
  const store = await cookies();
  store.set("ft_location", id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Location name is required."),
  address: z.string().optional(),
});

export async function updateLocation(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "manageUsers")) return { error: "Only owners can manage locations." };

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  try {
    const before = await prisma.location.findUnique({ where: { id: v.id } });
    const after = await prisma.location.update({
      where: { id: v.id },
      data: { name: v.name, address: v.address || null },
    });
    await logAudit({ userId: session.userId, action: "UPDATE", entity: "Location", entityId: v.id, before, after });
  } catch (e) {
    console.error(e);
    return { error: "Could not update the location." };
  }
  revalidatePath("/locations");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Delete a location only when it is empty (no records) and not the last one. */
export async function deleteLocation(id: string): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session || !can(session.role, "manageUsers")) return { error: "Not permitted." };

  const total = await prisma.location.count();
  if (total <= 1) return { error: "You can't delete your only location." };

  // Block deletion if anything references it, to avoid orphaning data.
  const [sales, expenses, purchases, users, deliveries, products, shifts] = await Promise.all([
    prisma.sale.count({ where: { locationId: id } }),
    prisma.expense.count({ where: { locationId: id } }),
    prisma.purchase.count({ where: { locationId: id } }),
    prisma.user.count({ where: { locationId: id } }),
    prisma.fuelDelivery.count({ where: { locationId: id } }),
    prisma.product.count({ where: { locationId: id } }),
    prisma.shift.count({ where: { locationId: id } }),
  ]);
  const refs = sales + expenses + purchases + users + deliveries + products + shifts;
  if (refs > 0) {
    return { error: "This location has records or users attached. Move or remove them first." };
  }

  try {
    const before = await prisma.location.findUnique({ where: { id } });
    await prisma.location.delete({ where: { id } });
    await logAudit({ userId: session.userId, action: "DELETE", entity: "Location", entityId: id, before });
  } catch (e) {
    console.error(e);
    return { error: "Could not delete the location." };
  }
  revalidatePath("/locations");
  revalidatePath("/", "layout");
  return { ok: true };
}
