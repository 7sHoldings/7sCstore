"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { money } from "@/lib/calc";
import { pushPrices } from "@/lib/integrations/sync";

async function authorize() {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." as const };
  if (!can(session.role, "enterPurchases")) return { error: "You don't have permission." as const };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." as const };
  return { session, locationId };
}

// ---------------------------------------------------------------------------
// Saving a parsed order
// ---------------------------------------------------------------------------

const lineSchema = z.object({
  sku: z.string().min(1).max(40),
  upc: z.string().min(1).max(40),
  upcNorm: z.string().max(40),
  description: z.string().max(300),
  quantity: z.coerce.number(),
  unitsPerCase: z.coerce.number().min(0),
  sizeLabel: z.string().max(80).nullable().optional(),
  caseCost: z.coerce.number().min(0),
  lineCost: z.coerce.number(),
  unitCost: z.coerce.number().min(0),
  srp: z.coerce.number().min(0),
});

const orderSchema = z.object({
  orderId: z.string().min(1).max(40),
  lines: z.array(lineSchema).min(1).max(3000),
});

export interface SaveResult {
  error?: string;
  ok?: boolean;
  orderId?: string;
  saved?: number;
}

/**
 * Store one parsed order. Re-uploading the same order replaces its lines rather
 * than duplicating them, so the owner can safely upload their whole history and
 * upload it again later.
 */
export async function saveGscOrder(input: unknown): Promise<SaveResult> {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };

  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid order." };
  const { orderId, lines } = parsed.data;

  // "Latest order" ordering key. Non-numeric ids fall back to 0 and rank oldest.
  const orderSeq = Number(String(orderId).replace(/\D/g, "")) || 0;

  // The same UPC can appear twice in one order — the last occurrence wins, which
  // matches how the vendor's own document reads.
  const bySku = new Map<string, (typeof lines)[number]>();
  for (const l of lines) bySku.set(l.sku, l);

  try {
    await prisma.$transaction([
      prisma.vendorOrderLine.deleteMany({ where: { locationId: auth.locationId, vendor: "GSC", orderId } }),
      prisma.vendorOrderLine.createMany({
        data: [...bySku.values()].map((l) => ({
          locationId: auth.locationId,
          vendor: "GSC",
          orderId,
          orderSeq,
          sku: l.sku,
          upc: l.upc,
          upcNorm: l.upcNorm || l.upc.replace(/\D/g, "").replace(/^0+/, ""),
          description: l.description,
          quantity: l.quantity,
          unitsPerCase: l.unitsPerCase > 0 ? l.unitsPerCase : 1,
          sizeLabel: l.sizeLabel ?? null,
          caseCost: money(l.caseCost),
          lineCost: money(l.lineCost),
          unitCost: Math.round((l.unitCost + Number.EPSILON) * 10000) / 10000,
          srp: money(l.srp),
        })),
        skipDuplicates: true,
      }),
    ]);
  } catch (e) {
    console.error("saveGscOrder failed", e);
    return { error: `Could not save order ${orderId}.` };
  }

  revalidatePath("/gsc");
  return { ok: true, orderId, saved: bySku.size };
}

/** Audit one completed upload batch. */
export async function finishGscImport(summary: { orders: number; lines: number }): Promise<void> {
  const auth = await authorize();
  if ("error" in auth) return;
  await logAudit({
    userId: auth.session.userId,
    action: "VENDOR_ORDER_IMPORT",
    entity: "VendorOrderLine",
    after: { vendor: "GSC", orders: Number(summary.orders) || 0, lines: Number(summary.lines) || 0 },
  });
  revalidatePath("/gsc");
}

// ---------------------------------------------------------------------------
// Department margins
// ---------------------------------------------------------------------------

const marginSchema = z.object({
  department: z.string().min(1).max(120),
  marginPct: z.coerce.number().min(0).max(95),
});

/** Set the target margin for one department. */
export async function setDepartmentMargin(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };

  const parsed = marginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid margin." };
  const { department, marginPct } = parsed.data;

  try {
    await prisma.departmentMargin.upsert({
      where: { locationId_department: { locationId: auth.locationId, department } },
      create: { locationId: auth.locationId, department, marginPct },
      update: { marginPct },
    });
    await logAudit({
      userId: auth.session.userId,
      action: "MARGIN_SET",
      entity: "DepartmentMargin",
      after: { department, marginPct },
    });
  } catch (e) {
    console.error(e);
    return { error: "Could not save that margin." };
  }

  revalidatePath("/gsc");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Applying price raises
// ---------------------------------------------------------------------------

const applySchema = z.object({
  items: z
    .array(z.object({ productId: z.string().min(1), newPrice: z.coerce.number().min(0) }))
    .min(1)
    .max(500),
});

export interface ApplyPricesResult {
  error?: string;
  ok?: boolean;
  updated?: number;
  pushed?: number;
  pushFailed?: number;
  live?: boolean;
}

/**
 * Set the selected products to the price chosen for each on the GSC screen —
 * by default the greatest of our price, the vendor SRP and the margin target,
 * but the screen can override that per row, including downwards. The price to
 * write therefore arrives per item rather than being recomputed here.
 *
 * POS-linked items go through the existing POS push so the register and the app
 * stay in step; anything not linked is updated locally.
 */
export async function applyTargetPrices(input: unknown): Promise<ApplyPricesResult> {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };

  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid selection." };
  const items = parsed.data.items;

  try {
    const products = await prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) }, locationId: auth.locationId },
      select: { id: true, posItemId: true, posDeptId: true, sellingPrice: true, name: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const changes = items
      .map((i) => ({ ...i, newPrice: money(i.newPrice), prev: byId.get(i.productId) }))
      .filter((c) => c.prev && c.newPrice > 0 && c.newPrice !== c.prev!.sellingPrice);

    if (changes.length === 0) return { ok: true, updated: 0, pushed: 0, pushFailed: 0 };

    // POS-linked items: push first, mirror locally only on success.
    const linked = changes.filter((c) => c.prev!.posItemId != null);
    let pushed = 0;
    let pushFailed = 0;
    let live = false;
    const pushedOk = new Set<string>();

    if (linked.length > 0) {
      const res = await pushPrices(
        auth.locationId,
        linked.map((c) => ({
          productId: c.productId,
          posItemId: c.prev!.posItemId as number,
          posDeptId: c.prev!.posDeptId ?? null,
          newRetail: c.newPrice,
        }))
      );
      live = res.live;
      for (const r of res.results) {
        if (r.ok) {
          pushed++;
          pushedOk.add(r.productId);
        } else {
          pushFailed++;
        }
      }
    }

    // Local-only items, plus any POS item whose push succeeded but which
    // pushPrices did not already mirror.
    const toWrite = changes.filter((c) => c.prev!.posItemId == null || pushedOk.has(c.productId));
    if (toWrite.length > 0) {
      await prisma.$transaction(
        toWrite.map((c) =>
          prisma.product.update({ where: { id: c.productId }, data: { sellingPrice: c.newPrice } })
        )
      );
    }

    try {
      await prisma.auditLog.createMany({
        data: toWrite.map((c) => ({
          userId: auth.session.userId,
          // Not necessarily a raise any more — the screen can pick a lower price
          // deliberately, and the audit has to be able to say so.
          action: "PRICE_SET_FROM_GSC",
          entity: "Product",
          entityId: c.productId,
          before: JSON.stringify({ sellingPrice: c.prev!.sellingPrice }),
          after: JSON.stringify({
            sellingPrice: c.newPrice,
            source: "GSC",
            direction: c.newPrice > c.prev!.sellingPrice ? "raise" : "lower",
          }),
        })),
      });
    } catch (e) {
      console.error("price raise audit failed", e);
    }

    revalidatePath("/gsc");
    revalidatePath("/inventory");
    return { ok: true, updated: toWrite.length, pushed, pushFailed, live };
  } catch (e) {
    console.error("applyTargetPrices failed", e);
    return { error: "Could not apply those prices." };
  }
}
