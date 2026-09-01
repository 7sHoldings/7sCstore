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

// ---------------------------------------------------------------------------
// Connection check
// ---------------------------------------------------------------------------

export interface ConnectionCheck {
  error?: string;
  cookiePresent: boolean;
  cookieNames: string[];
  cookieLength: number;
  hasSession: boolean;
  hasClearance: boolean;
  /** ISO string; null when cf_clearance is absent or unparseable. */
  clearanceIssuedAt: string | null;
  reportHost: string;
  inventoryHost: string;
  /** The host is pinned by an environment variable rather than the default. */
  reportOverridden: boolean;
  inventoryOverridden: boolean;
  userAgent: string;
  /** Result of actually asking Modisoft to select the store. */
  probeOk: boolean;
  probeMessage: string;
}

/**
 * Report what this deployment actually holds and what Modisoft does with it.
 *
 * Refreshing MODI_COOKIE and still seeing the same failure has two very
 * different causes that look identical from the outside: the new cookie was
 * saved but the deployment was never rebuilt, so the server is still running
 * the old one; or the new cookie genuinely is not accepted. Guessing between
 * them has cost days, so this states which it is — the age of the cookie the
 * server is holding, and the exact answer Modisoft gives it.
 *
 * Cookie VALUES never leave the server. Only names, lengths and issue times.
 */
export async function checkConnection(): Promise<ConnectionCheck> {
  const empty: ConnectionCheck = {
    cookiePresent: false, cookieNames: [], cookieLength: 0,
    hasSession: false, hasClearance: false, clearanceIssuedAt: null,
    reportHost: "", inventoryHost: "", reportOverridden: false, inventoryOverridden: false, userAgent: "",
    probeOk: false, probeMessage: "",
  };
  const session = await getSession();
  if (!session) return { ...empty, error: "Not authenticated." };
  if (!can(session.role, "viewAll")) return { ...empty, error: "You don't have permission." };

  const { describeCookie, probeModiSession } = await import("@/lib/integrations/modiInsights");
  const facts = describeCookie();
  const probe = facts.present
    ? await probeModiSession()
    : { ok: false, message: "MODI_COOKIE is not set on this deployment.", host: "" };

  return {
    cookiePresent: facts.present,
    cookieNames: facts.names,
    cookieLength: facts.length,
    hasSession: facts.hasSession,
    hasClearance: facts.hasClearance,
    clearanceIssuedAt: facts.clearanceIssuedAt ? facts.clearanceIssuedAt.toISOString() : null,
    reportHost: new URL(facts.reportBase).host,
    inventoryHost: new URL(facts.inventoryBase).host,
    reportOverridden: facts.reportOverridden,
    inventoryOverridden: facts.inventoryOverridden,
    userAgent: facts.userAgent,
    probeOk: probe.ok,
    probeMessage: probe.message,
  };
}
