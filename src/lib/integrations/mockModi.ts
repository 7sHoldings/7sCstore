import type { PosAdapter, NormalizedSale } from "./types";

/**
 * Mock Modi adapter — stands in for the real POS feed so the whole sync pipeline
 * (trigger → log → import → reports) is exercisable before Modi API credentials
 * exist. It fabricates a plausible day of sales since `since`.
 */
export const mockModiAdapter: PosAdapter = {
  id: "POS_MODI",
  label: "Modi POS (sandbox)",
  isConfigured: () => true,
  async fetchSince(since: Date): Promise<NormalizedSale[]> {
    const sales: NormalizedSale[] = [];
    const start = new Date(since);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // One representative batch per day from `since` up to today (cap 14 days).
    let day = new Date(start);
    let guard = 0;
    while (day <= today && guard < 14) {
      const stamp = new Date(day);
      stamp.setHours(15, 0, 0, 0);
      const grades = ["REGULAR", "PREMIUM", "DIESEL"] as const;
      for (const grade of grades) {
        const gallons = Math.round(120 + Math.random() * 200);
        const price = +(3.2 + Math.random() * 0.6).toFixed(4);
        sales.push({
          date: stamp,
          category: "FUEL",
          paymentType: Math.random() < 0.6 ? "CARD" : "CASH",
          amount: +(gallons * price).toFixed(2),
          note: `Modi sync · ${grade}`,
          fuel: { grade, gallons, pricePerGallon: price, costPerGallon: +(price - 0.45).toFixed(4), taxPerGallon: 0.184 },
        });
      }
      sales.push({
        date: stamp,
        category: "STORE",
        paymentType: "CARD",
        amount: +(200 + Math.random() * 300).toFixed(2),
        taxCollected: +(20 + Math.random() * 20).toFixed(2),
        note: "Modi sync · store",
      });
      day = new Date(day);
      day.setDate(day.getDate() + 1);
      guard++;
    }
    return sales;
  },
};
