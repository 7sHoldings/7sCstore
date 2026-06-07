"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  locationName: z.string().min(1, "Location name is required."),
  ownerName: z.string().min(1, "Your name is required."),
  email: z.string().email("Enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

/**
 * First-run setup. Creates the first location + owner account, but ONLY when the
 * database has no users yet — so it can't be abused once the app is in use.
 */
export async function setupAction(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string }> {
  const count = await prisma.user.count();
  if (count > 0) return { error: "Setup is already complete. Please sign in." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const v = parsed.data;

  let userId = "";
  let locationId = "";
  try {
    const location = await prisma.location.create({ data: { name: v.locationName } });
    locationId = location.id;
    const user = await prisma.user.create({
      data: {
        name: v.ownerName,
        email: v.email.toLowerCase(),
        passwordHash: await hashPassword(v.password),
        role: "OWNER",
        locationId: location.id,
      },
    });
    userId = user.id;
    await logAudit({ userId: user.id, action: "SETUP", entity: "User", entityId: user.id });
  } catch (e) {
    console.error(e);
    return { error: "Could not complete setup. Please try again." };
  }

  await createSession({
    userId,
    name: v.ownerName,
    email: v.email.toLowerCase(),
    role: "OWNER",
    locationId,
  });
  redirect("/daily");
}
