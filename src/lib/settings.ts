import "server-only";
import { prisma } from "./db";

/** Read a string setting from the generic Setting store. */
export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getBoolSetting(key: string): Promise<boolean> {
  return (await getSetting(key)) === "true";
}

/** Store sales-tax rate as a percent (default Henderson, NV combined ≈ 8.375%). */
export async function getTaxRate(): Promise<number> {
  const v = await getSetting("taxRate");
  const n = v ? Number(v) : NaN;
  return isFinite(n) && n >= 0 ? n : 8.375;
}
