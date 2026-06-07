/**
 * Modisoft → 7sCstores value mappings, derived from real Insights report data
 * (fuel grades: Regular/Plus/V Power/Diesel; departments: CIGARETTES, BEER,
 * CANDY, etc.). These are independent of the API transport, so they're reused by
 * whichever Modisoft adapter we finalize once official API access is granted.
 */
import type { NormalizedSale } from "./types";

type Grade = NonNullable<NormalizedSale["fuel"]>["grade"];
type Category = NormalizedSale["category"];

/** Map a Modisoft fuel-grade label to our grade enum. */
export function mapFuelType(fuelType: string): Grade {
  const t = fuelType.trim().toLowerCase();
  if (t.includes("diesel")) return "DIESEL";
  if (t.includes("plus") || t.includes("mid") || t === "super") return "MID";
  if (
    t.includes("premium") ||
    t.includes("v power") ||
    t.includes("vpower") ||
    t.includes("v-power") ||
    t.includes("supreme") ||
    t.includes("ultra")
  )
    return "PREMIUM";
  return "REGULAR";
}

/** Map a Modisoft department name to our coarse sale category. */
export function mapDeptToCategory(deptName: string): Category {
  const d = (deptName || "").toLowerCase();
  if (/cigarette|tobacco|chew|cigar|vape|nicotine|hookah/.test(d)) return "TOBACCO";
  if (/lottery|lotto|scratch/.test(d)) return "LOTTERY";
  if (/beer|wine|liquor|alcohol|soda|drink|beverage|candy|snack|food|coffee|deli|grocery|water|juice|tea|energy/.test(d))
    return "FOOD_DRINK";
  if (/fuel|gas|diesel/.test(d)) return "FUEL";
  return "STORE";
}

/** Net payment split helper: turn cash/credit totals into two normalized rows. */
export function splitByPayment(
  base: Omit<NormalizedSale, "paymentType" | "amount">,
  amountCash: number,
  amountCard: number
): NormalizedSale[] {
  const out: NormalizedSale[] = [];
  if (amountCash > 0) out.push({ ...base, paymentType: "CASH", amount: round2(amountCash) });
  if (amountCard > 0) out.push({ ...base, paymentType: "CARD", amount: round2(amountCard) });
  return out;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
