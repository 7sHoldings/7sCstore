"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  name: z.string().min(1, "Name is required."),
  email: z.string().email("Enter a valid email."),
  role: z.enum(["OWNER", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function createUser(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "manageUsers")) return { error: "Only owners can manage users." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: v.email.toLowerCase() } });
  if (existing) return { error: "A user with that email already exists." };

  try {
    const user = await prisma.user.create({
      data: {
        name: v.name,
        email: v.email.toLowerCase(),
        role: v.role,
        passwordHash: await hashPassword(v.password),
        locationId: session.locationId,
      },
    });
    await logAudit({ userId: session.userId, action: "CREATE", entity: "User", entityId: user.id, after: { name: user.name, email: user.email, role: user.role } });
  } catch (e) {
    console.error(e);
    return { error: "Could not create the user." };
  }
  revalidatePath("/users");
  return { ok: true };
}

export async function toggleUserActive(id: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "manageUsers")) return;
  if (id === session.userId) return; // can't disable yourself
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return;
  await prisma.user.update({ where: { id }, data: { active: !user.active } });
  await logAudit({ userId: session.userId, action: "UPDATE", entity: "User", entityId: id, before: { active: user.active }, after: { active: !user.active } });
  revalidatePath("/users");
}

const editSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Name is required."),
  email: z.string().email("Enter a valid email."),
});

export async function updateUser(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "manageUsers")) return { error: "Only owners can manage users." };

  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;
  const email = v.email.toLowerCase();

  const clash = await prisma.user.findFirst({ where: { email, NOT: { id: v.id } } });
  if (clash) return { error: "Another user already uses that email." };

  try {
    const before = await prisma.user.findUnique({ where: { id: v.id } });
    await prisma.user.update({ where: { id: v.id }, data: { name: v.name, email } });
    await logAudit({
      userId: session.userId,
      action: "UPDATE",
      entity: "User",
      entityId: v.id,
      before: { name: before?.name, email: before?.email },
      after: { name: v.name, email },
    });
  } catch (e) {
    console.error(e);
    return { error: "Could not update the user." };
  }
  revalidatePath("/users");
  return { ok: true };
}

export async function changeUserRole(id: string, role: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "manageUsers")) return;
  const valid = ["OWNER", "MANAGER", "ACCOUNTANT", "EMPLOYEE"];
  if (!valid.includes(role)) return;
  const before = await prisma.user.findUnique({ where: { id } });
  await prisma.user.update({ where: { id }, data: { role: role as never } });
  await logAudit({ userId: session.userId, action: "UPDATE", entity: "User", entityId: id, before: { role: before?.role }, after: { role } });
  revalidatePath("/users");
}
