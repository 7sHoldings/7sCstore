"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";

export async function markAlertRead(id: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  await prisma.alert.update({ where: { id }, data: { read: true } });
  revalidatePath("/alerts");
}

export async function updateThresholds(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "viewAll")) return;

  const keys = ["lowProfitDay", "highExpense", "lowInventory", "unusualSalesDropPct"];
  for (const key of keys) {
    const raw = formData.get(key);
    if (raw == null) continue;
    const value = Number(raw);
    if (Number.isNaN(value)) continue;
    await prisma.alertSetting.upsert({
      where: { key },
      create: { key, value, enabled: true },
      update: { value },
    });
  }
  revalidatePath("/alerts");
}
