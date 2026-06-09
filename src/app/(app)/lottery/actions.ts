"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { setLotteryManual } from "@/lib/lottery";
import { logAudit } from "@/lib/audit";

/** Save the employee's manual lottery sales + lotto payout for a day. */
export async function saveLotteryManual(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "enterSales")) return;
  const loc = await getActiveLocationId();
  if (!loc) return;

  const date = String(formData.get("date") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const sales = Number(formData.get("sales"));
  const payout = Number(formData.get("payout"));
  if (!isFinite(sales) || !isFinite(payout) || sales < 0 || payout < 0) return;

  await setLotteryManual(loc, date, sales, payout);
  await logAudit({
    userId: session.userId,
    action: "UPDATE",
    entity: "Setting",
    entityId: `lottomanual:${loc}:${date}`,
    after: { sales, payout },
  });
  revalidatePath("/lottery");
  revalidatePath("/daily");
}
