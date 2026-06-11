"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { setReorderLevel, TANK_GRADES } from "@/lib/tank";

/** Owner/manager sets the reorder (reminder) level in gallons per tank. */
export async function setReorderLevels(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "viewAll")) return;
  const loc = await getActiveLocationId();
  if (!loc) return;
  for (const g of TANK_GRADES) {
    const raw = formData.get(`reorder_${g}`);
    if (raw == null || String(raw).trim() === "") continue;
    const n = Number(raw);
    if (isFinite(n) && n >= 0) await setReorderLevel(loc, g, n);
  }
  revalidatePath("/fuel");
}
