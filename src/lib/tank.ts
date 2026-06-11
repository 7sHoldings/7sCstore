/**
 * Fuel tank stick readings and reorder levels. Readings are sparse (employees
 * stick the tanks on random days); the current balance is the latest reading
 * converted to gallons via the strapping chart. Stored in the Setting table.
 */
import "server-only";
import { prisma } from "./db";
import { getSetting, setSetting } from "./settings";
import { gallonsForInches } from "./tankChart";
import { money } from "./calc";

/** Physical tanks (mid-grade is blended, so it has no tank of its own). */
export const TANK_GRADES = ["REGULAR", "PREMIUM", "DIESEL"] as const;
export type TankGrade = (typeof TANK_GRADES)[number];

export interface TankReading {
  date: string;
  inches: number;
  gallons: number;
}

function rKey(loc: string, grade: string, date: string) { return `tankreading:${loc}:${grade}:${date}`; }

/** Save a stick reading; gallons are derived from the chart. */
export async function setTankReading(loc: string, grade: string, date: string, inches: number): Promise<void> {
  const gallons = gallonsForInches(inches);
  await setSetting(rKey(loc, grade, date), JSON.stringify({ inches: money(inches), gallons }));
}

/** All readings for a grade, newest first. */
export async function getReadings(loc: string, grade: string): Promise<TankReading[]> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: `tankreading:${loc}:${grade}:` } } });
  const out: TankReading[] = [];
  for (const r of rows) {
    const date = r.key.split(":").pop()!;
    try {
      const o = JSON.parse(r.value);
      out.push({ date, inches: Number(o.inches) || 0, gallons: Number(o.gallons) || 0 });
    } catch { /* skip */ }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** The most recent reading for a grade, or null. */
export async function getLatestReading(loc: string, grade: string): Promise<TankReading | null> {
  const all = await getReadings(loc, grade);
  return all[0] ?? null;
}

export async function getReorderLevel(loc: string, grade: string): Promise<number> {
  const v = await getSetting(`reorder:${loc}:${grade}`);
  const n = v ? Number(v) : NaN;
  return isFinite(n) && n >= 0 ? n : 0;
}

export async function setReorderLevel(loc: string, grade: string, gallons: number): Promise<void> {
  await setSetting(`reorder:${loc}:${grade}`, String(money(gallons)));
}
