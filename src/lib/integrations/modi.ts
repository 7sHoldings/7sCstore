import type { PosAdapter, NormalizedSale } from "./types";

/**
 * Real Modi POS adapter (Phase 2). Gated by env config — until MODI_API_URL and
 * MODI_API_KEY are set it reports itself unconfigured and the app falls back to
 * the sandbox adapter. The response shape below is a best-effort mapping; adjust
 * the field names once Modi's API documentation is available.
 */
export const modiAdapter: PosAdapter = {
  id: "POS_MODI",
  label: "Modi POS",
  isConfigured: () => Boolean(process.env.MODI_API_URL && process.env.MODI_API_KEY),

  async fetchSince(since: Date): Promise<NormalizedSale[]> {
    const base = process.env.MODI_API_URL!;
    const key = process.env.MODI_API_KEY!;
    const url = `${base.replace(/\/$/, "")}/sales?since=${encodeURIComponent(since.toISOString())}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Modi API responded ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { sales?: unknown[] };
    const rows = Array.isArray(data.sales) ? data.sales : [];

    // Map Modi's payload to NormalizedSale. Field names are assumptions to be
    // confirmed against the real API docs.
    const GRADES = ["REGULAR", "MID", "PREMIUM", "DIESEL"] as const;
    const CATS = ["FUEL", "STORE", "LOTTERY", "TOBACCO", "FOOD_DRINK", "OTHER"] as const;

    return rows.map((raw): NormalizedSale => {
      const r = raw as Record<string, unknown>;
      const categoryRaw = String(r.category ?? "OTHER").toUpperCase();
      const category = (CATS as readonly string[]).includes(categoryRaw)
        ? (categoryRaw as NormalizedSale["category"])
        : "OTHER";
      const gradeRaw = String(r.fuel_grade ?? "REGULAR").toUpperCase();
      const grade = (GRADES as readonly string[]).includes(gradeRaw)
        ? (gradeRaw as (typeof GRADES)[number])
        : "REGULAR";
      return {
        date: new Date(String(r.timestamp ?? r.date ?? Date.now())),
        category,
        paymentType: String(r.payment_type ?? "CARD").toUpperCase() === "CASH" ? "CASH" : "CARD",
        amount: Number(r.amount ?? 0),
        taxCollected: Number(r.tax ?? 0),
        note: "Modi sync",
        fuel:
          category === "FUEL"
            ? {
                grade,
                gallons: Number(r.gallons ?? 0),
                pricePerGallon: Number(r.price_per_gallon ?? 0),
                costPerGallon: Number(r.cost_per_gallon ?? 0),
                taxPerGallon: Number(r.tax_per_gallon ?? 0),
              }
            : undefined,
      };
    });
  },
};
