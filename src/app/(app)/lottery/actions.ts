"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { setLotteryManual } from "@/lib/lottery";
import { uploadReceiptsFromForm } from "@/lib/storage";
import { addReceipts } from "@/lib/receipts";
import { logAudit } from "@/lib/audit";

/** Quick inline edit of just the lottery numbers (no receipts) — used from Daily Sales. */
export async function saveLotteryNumbers(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission." };
  const loc = await getActiveLocationId();
  if (!loc) return { error: "No location assigned." };

  const date = String(formData.get("date") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick a valid date." };
  const sales = Number(formData.get("sales"));
  const payout = Number(formData.get("payout"));
  if (!isFinite(sales) || !isFinite(payout) || sales < 0 || payout < 0) return { error: "Enter valid amounts." };

  try {
    await setLotteryManual(loc, date, sales, payout);
    await logAudit({ userId: session.userId, action: "UPDATE", entity: "Setting", entityId: `lottomanual:${loc}:${date}`, after: { sales, payout } });
    revalidatePath("/lottery");
    revalidatePath("/daily");
    revalidatePath("/dashboard");
    revalidatePath("/monthly");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { error: "Could not save the lottery numbers." };
  }
}

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

  const photos = await uploadReceiptsFromForm(formData, "photos", `${loc}/lottery/${date}`);
  await addReceipts(loc, "lottery", date, photos);

  await logAudit({
    userId: session.userId,
    action: "UPDATE",
    entity: "Setting",
    entityId: `lottomanual:${loc}:${date}`,
    after: { sales, payout },
  });
  revalidatePath("/lottery");
  revalidatePath("/daily");
  redirect(`/lottery?date=${date}&saved=1`);
}
