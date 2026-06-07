"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  name: z.string().min(1, "Location name is required."),
  address: z.string().optional(),
});

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
