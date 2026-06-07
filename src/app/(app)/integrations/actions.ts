"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { runSync } from "@/lib/integrations/sync";
import { logAudit } from "@/lib/audit";

export async function triggerSync(): Promise<{ error?: string; ok?: boolean; imported?: number }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "viewAll")) return { error: "You don't have permission to run a sync." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No active location." };

  try {
    const { imported, live } = await runSync(locationId);
    await logAudit({ userId: session.userId, action: "SYNC", entity: "SyncLog", after: { imported, live } });
    revalidatePath("/integrations");
    revalidatePath("/dashboard");
    return { ok: true, imported };
  } catch (e) {
    revalidatePath("/integrations");
    return { error: e instanceof Error ? e.message : "Sync failed." };
  }
}
