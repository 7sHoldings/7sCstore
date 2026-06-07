import type { PosAdapter, NormalizedSale } from "./types";
import { mapFuelType, mapDeptToCategory } from "./modiMap";

/**
 * Modisoft POS adapter (official API). Env-gated: until MODI_API_URL and
 * MODI_API_KEY are set, the app falls back to the sandbox adapter.
 *
 * The exact endpoint paths and JSON field names below are placeholders to be
 * confirmed against Modisoft's official API documentation / a sample response.
 * The value mappings (fuel grade, department → category) are already derived
 * from real Modisoft Insights data in `modiMap.ts`, so finalizing this adapter
 * is just aligning field names + the request shape.
 */
export const modiAdapter: PosAdapter = {
  id: "POS_MODI",
  label: "Modisoft POS",
  isConfigured: () => Boolean(process.env.MODI_API_URL && process.env.MODI_API_KEY),

  async fetchSince(since: Date): Promise<NormalizedSale[]> {
    const base = process.env.MODI_API_URL!.replace(/\/$/, "");
    const key = process.env.MODI_API_KEY!;
    const store = process.env.MODI_STORE_ID; // optional store filter

    const params = new URLSearchParams({ from: since.toISOString() });
    if (store) params.set("store", store);

    const res = await fetch(`${base}/sales?${params.toString()}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Modisoft API responded ${res.status} ${res.statusText}`);

    const data = (await res.json()) as { fuel?: unknown[]; departments?: unknown[]; sales?: unknown[] };
    const out: NormalizedSale[] = [];

    // --- Fuel rows (grade, gallons, price, cash/credit split) ---
    for (const raw of data.fuel ?? []) {
      const r = raw as Record<string, unknown>;
      const date = new Date(String(r.date ?? r.timestamp ?? Date.now()));
      const grade = mapFuelType(String(r.fuelType ?? r.FuelType ?? "Regular"));
      const gallons = num(r.volume ?? r.Volume);
      const price = num(r.retail ?? r.Retail ?? r.RptRetail);
      const amountCash = num(r.amountCash ?? r.AmountCash);
      const amountCard = num(r.amountCreditDebit ?? r.AmountCreditDebit);
      const total = num(r.amount ?? r.Amount) || amountCash + amountCard;

      for (const [pay, amt] of pairs(amountCash, amountCard, total)) {
        out.push({
          date,
          category: "FUEL",
          paymentType: pay,
          amount: amt,
          note: "Modisoft sync",
          fuel: { grade, gallons: shareGallons(gallons, amt, total), pricePerGallon: price, taxPerGallon: 0 },
        });
      }
    }

    // --- Store / department rows ---
    for (const raw of data.departments ?? []) {
      const r = raw as Record<string, unknown>;
      const date = new Date(String(r.date ?? r.timestamp ?? Date.now()));
      const category = mapDeptToCategory(String(r.deptName ?? r.DeptName ?? ""));
      const amountCash = num(r.salesCash ?? r.SalesCash);
      const amountCard = num(r.salesCreditDebit ?? r.SalesCreditDebit);
      const total = num(r.netSales ?? r.NetSales ?? r.sales ?? r.Sales) || amountCash + amountCard;
      const refundTotal = num(r.refund ?? r.Refund);

      for (const [pay, amt] of pairs(amountCash, amountCard, total)) {
        out.push({
          date,
          category,
          paymentType: pay,
          amount: amt,
          refund: total > 0 ? round2((refundTotal * amt) / total) : 0,
          note: String(r.deptName ?? r.DeptName ?? "Modisoft sync"),
        } as NormalizedSale);
      }
    }

    return out;
  },
};

function num(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
/** Split a total into [payment, amount] pairs by cash/card; fall back to card. */
function pairs(cash: number, card: number, total: number): [NormalizedSale["paymentType"], number][] {
  if (cash > 0 || card > 0) {
    const res: [NormalizedSale["paymentType"], number][] = [];
    if (cash > 0) res.push(["CASH", round2(cash)]);
    if (card > 0) res.push(["CARD", round2(card)]);
    return res;
  }
  return [["CARD", round2(total)]];
}
/** Apportion gallons to a payment slice proportional to its dollar share. */
function shareGallons(totalGallons: number, sliceAmount: number, totalAmount: number): number {
  if (totalAmount <= 0) return totalGallons;
  return round2((totalGallons * sliceAmount) / totalAmount);
}
