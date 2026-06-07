"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { runSync, logBackfill } from "@/lib/integrations/sync";
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

/** Record a one-line sync-log entry after a multi-chunk backfill completes. */
export async function finishBackfill(total: number, fromISO: string, toISO: string): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "viewAll")) return;
  const locationId = await getActiveLocationId();
  if (!locationId) return;
  await logBackfill(locationId, total, fromISO, toISO);
  await logAudit({ userId: session.userId, action: "BACKFILL", entity: "SyncLog", after: { total, fromISO, toISO } });
  revalidatePath("/integrations");
  revalidatePath("/dashboard");
}
