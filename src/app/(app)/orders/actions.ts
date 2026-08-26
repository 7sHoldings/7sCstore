"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { generateDraftOrder, refreshDraftOrder } from "@/lib/vendors/draftOrder";
import { DEFAULT_COVER_WEEKS } from "@/lib/vendors/reorder";
import { syncDemand } from "@/lib/integrations/sync";

async function authorize() {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." as const };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission." as const };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." as const };
  return { session, locationId };
}

export interface OrderResult {
  error?: string;
  ok?: boolean;
  lines?: number;
  notes?: string[];
}

/** Rebuild the open draft from current demand. */
export async function rebuildDraft(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ("error" in auth) return;
  const coverRaw = Number(formData.get("coverWeeks"));
  const coverWeeks = isFinite(coverRaw) && coverRaw > 0 ? Math.min(8, coverRaw) : DEFAULT_COVER_WEEKS;
  await generateDraftOrder(auth.locationId, { vendor: "GSC", coverWeeks });
  await logAudit({
    userId: auth.session.userId,
    action: "REORDER_BUILD",
    entity: "PurchaseOrder",
    after: { vendor: "GSC", coverWeeks },
  });
  revalidatePath("/orders");
}

const casesSchema = z.object({
  lineId: z.string().min(1),
  cases: z.coerce.number().min(0).max(999),
});

/** Adjust one line's case count. */
export async function setLineCases(input: unknown): Promise<OrderResult> {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };
  const parsed = casesSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid quantity." };

  try {
    const line = await prisma.purchaseOrderLine.findFirst({
      where: { id: parsed.data.lineId, purchaseOrder: { locationId: auth.locationId, status: "DRAFT" } },
      select: { id: true },
    });
    if (!line) return { error: "That line isn't on an open draft." };
    // Flagging the edit is what stops the daily refresh from overwriting it.
    await prisma.purchaseOrderLine.update({
      where: { id: line.id },
      data: { cases: parsed.data.cases, edited: true },
    });
  } catch (e) {
    console.error(e);
    return { error: "Could not save that quantity." };
  }
  revalidatePath("/orders");
  return { ok: true };
}

/** Drop a line from the draft entirely. */
export async function removeLine(input: unknown): Promise<OrderResult> {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };
  const id = z.string().min(1).safeParse((input as { lineId?: string })?.lineId);
  if (!id.success) return { error: "Invalid line." };

  try {
    await prisma.purchaseOrderLine.deleteMany({
      where: { id: id.data, purchaseOrder: { locationId: auth.locationId, status: "DRAFT" } },
    });
  } catch (e) {
    console.error(e);
    return { error: "Could not remove that line." };
  }
  revalidatePath("/orders");
  return { ok: true };
}

/** Mark the draft placed once it has been keyed into the vendor's portal. */
export async function markPlaced(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ("error" in auth) return;
  const id = String(formData.get("purchaseOrderId") ?? "");
  if (!id) return;

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, locationId: auth.locationId, status: "DRAFT" },
    include: { _count: { select: { lines: true } } },
  });
  if (!po) return;

  await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { status: "PLACED", placedAt: new Date() },
  });
  await logAudit({
    userId: auth.session.userId,
    action: "ORDER_PLACED",
    entity: "PurchaseOrder",
    entityId: po.id,
    after: { vendor: po.vendor, lines: po._count.lines },
  });
  revalidatePath("/orders");
}

/**
 * Build an order right now, for any day of the week.
 *
 * Pulls today's sales history first so the forecast reflects everything sold up
 * to this moment, then rebuilds the draft from scratch. This is the button to
 * press when ordering on a Friday instead of waiting for Monday.
 */
export async function createOrderNow(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ("error" in auth) return;

  const coverRaw = Number(formData.get("coverWeeks"));
  const coverWeeks = isFinite(coverRaw) && coverRaw > 0 ? Math.min(8, coverRaw) : DEFAULT_COVER_WEEKS;

  // Fresh sales first; a failure here still leaves the previous window usable.
  let measured = 0;
  try {
    const d = await syncDemand(auth.locationId);
    measured = d.measured;
  } catch (e) {
    console.error("sales pull failed, building from the last known window", e);
  }

  const built = await generateDraftOrder(auth.locationId, { vendor: "GSC", coverWeeks });
  await logAudit({
    userId: auth.session.userId,
    action: "ORDER_BUILT_NOW",
    entity: "PurchaseOrder",
    entityId: built.purchaseOrderId,
    after: { lines: built.lines, coverWeeks, measuredProducts: measured },
  });
  revalidatePath("/orders");
}

/**
 * Update the open draft from the latest sales without discarding hand-set
 * quantities. This is what the daily job calls between Mondays.
 */
export async function refreshDemand(): Promise<void> {
  const auth = await authorize();
  if ("error" in auth) return;
  try {
    const d = await syncDemand(auth.locationId);
    const r = await refreshDraftOrder(auth.locationId, { vendor: "GSC" });
    await logAudit({
      userId: auth.session.userId,
      action: "ORDER_REFRESHED",
      entity: "PurchaseOrder",
      entityId: r.purchaseOrderId,
      after: { measured: d.measured, updated: r.updated, added: r.added, removed: r.removed, kept: r.kept },
    });
  } catch (e) {
    console.error("demand refresh failed", e);
  }
  revalidatePath("/orders");
}
