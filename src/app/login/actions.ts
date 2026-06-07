"use server";

import { redirect } from "next/navigation";
import { authenticate, createSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function loginAction(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const session = await authenticate(email, password);
  if (!session) {
    return { error: "Invalid email or password." };
  }

  await createSession(session);
  await logAudit({ userId: session.userId, action: "LOGIN", entity: "User", entityId: session.userId });
  redirect("/daily");
}
