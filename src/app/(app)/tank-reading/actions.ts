"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { setTankReading, TANK_GRADES } from "@/lib/tank";
import { logAudit } from "@/lib/audit";

/** Save the day's stick readings (inches) for each tank. */
export async function saveTankReading(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return;
  const loc = await getActiveLocationId();
  if (!loc) return;

  const date = String(formData.get("date") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  let saved = 0;
  for (const g of TANK_GRADES) {
    const raw = formData.get(`inches_${g}`);
    if (raw == null || String(raw).trim() === "") continue;
    const inches = Number(raw);
    if (isFinite(inches) && inches >= 0) { await setTankReading(loc, g, date, inches); saved++; }
  }
  if (saved) await logAudit({ userId: session.userId, action: "CREATE", entity: "TankReading", entityId: date, after: { date } });

  revalidatePath("/tank-reading");
  revalidatePath("/fuel");
  redirect("/tank-reading?saved=1");
}
