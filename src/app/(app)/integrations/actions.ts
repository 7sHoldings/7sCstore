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
  /** "login" (automatic sign-in), "manual" (pasted), "env" (MODI_COOKIE), "none". */
  cookieSource: string;
  /** ISO time the app saved the session; null for MODI_COOKIE. */
  cookieSavedAt: string | null;
  /** MODI_USERNAME + MODI_PASSWORD are set. */
  autoLogin: boolean;
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
    cookieSource: "none", cookieSavedAt: null, autoLogin: false,
    cookiePresent: false, cookieNames: [], cookieLength: 0,
    hasSession: false, hasClearance: false, clearanceIssuedAt: null,
    reportHost: "", inventoryHost: "", reportOverridden: false, inventoryOverridden: false, userAgent: "",
    probeOk: false, probeMessage: "",
  };
  const session = await getSession();
  if (!session) return { ...empty, error: "Not authenticated." };
  if (!can(session.role, "viewAll")) return { ...empty, error: "You don't have permission." };

  const { describeCookie, probeModiSession } = await import("@/lib/integrations/modiInsights");
  // Probe first: it may sign in afresh, and the facts should describe the
  // session the probe ended up with.
  const probe = await probeModiSession();
  const facts = await describeCookie();

  return {
    cookieSource: facts.source,
    cookieSavedAt: facts.savedAt ? facts.savedAt.toISOString() : null,
    autoLogin: facts.autoLogin,
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

// ---------------------------------------------------------------------------
// Modisoft sign-in (no more copying cookies into Vercel)
// ---------------------------------------------------------------------------

async function requireAdmin(): Promise<{ userId: string } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "viewAll")) return { error: "You don't have permission." };
  return { userId: session.userId };
}

/** Sign in to Modisoft now with MODI_USERNAME / MODI_PASSWORD and save the session. */
export async function modiSignInNow(): Promise<{ ok?: boolean; error?: string }> {
  const who = await requireAdmin();
  if ("error" in who) return who;
  try {
    const { forceModiLogin } = await import("@/lib/integrations/modiInsights");
    await forceModiLogin();
    await logAudit({ userId: who.userId, action: "MODI_SIGN_IN", entity: "Setting", after: { via: "login" } });
    revalidatePath("/integrations");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sign-in failed." };
  }
}

/**
 * Save a pasted Cookie header in the database. It is tested against Modisoft
 * first, so a bad paste is reported rather than saved. Takes effect at once —
 * no Vercel environment variable, no redeploy.
 */
export async function saveModiCookie(raw: string): Promise<{ ok?: boolean; error?: string }> {
  const who = await requireAdmin();
  if ("error" in who) return who;
  // Accept a pasted "Cookie: …" line or the bare value.
  const cookie = raw.trim().replace(/^cookie:\s*/i, "").replace(/[\r\n]+/g, " ").trim();
  if (!cookie || !cookie.includes("=")) return { error: "That doesn't look like a Cookie header (expected name=value; name=value…)." };
  try {
    const { testCookie } = await import("@/lib/integrations/modiInsights");
    const { saveSession } = await import("@/lib/integrations/modiSession");
    const working = await testCookie(cookie);
    await saveSession(working, "manual");
    await logAudit({ userId: who.userId, action: "MODI_SIGN_IN", entity: "Setting", after: { via: "paste" } });
    revalidatePath("/integrations");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Modisoft did not accept that cookie." };
  }
}
