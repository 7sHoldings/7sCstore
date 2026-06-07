import type { PosAdapter, NormalizedSale } from "./types";
import { mapFuelType, mapDeptToCategory } from "./modiMap";

/**
 * Interim Modisoft adapter that replays a logged-in **Insights session cookie**
 * against insights1.modisoft.com (the same endpoints seen in the HAR captures).
 * This works until the official API is available, but the cookie is short-lived
 * — when it expires, a sync fails and you refresh MODI_COOKIE in Vercel.
 *
 * Config: MODI_COOKIE (required) — the full `Cookie:` header value from a logged
 * in Insights browser session.
 */
const BASE = "https://insights1.modisoft.com";

export const modiInsightsAdapter: PosAdapter = {
  id: "POS_MODI",
  label: "Modisoft (Insights session)",
  isConfigured: () => Boolean(process.env.MODI_COOKIE),

  async fetchSince(since: Date): Promise<NormalizedSale[]> {
    const cookie = process.env.MODI_COOKIE!;
    const storeId = process.env.MODI_STORE_ID || "16";
    const ccode = process.env.MODI_CCODE || "854388";
    const out: NormalizedSale[] = [];

    // Select the store in the session first (mirrors /Home/ChangeStore in the UI)
    // so the report endpoints return this store's data.
    await changeStore(cookie, storeId, ccode);

    for (const day of daysFrom(since)) {
      const FromDate = `${fmtDate(day)} 12:00 AM`;
      const ToDate = `${fmtDate(day)} 11:59 PM`;

      // ---- Fuel (ReportID 545) ----
      const fuel = await post(cookie, "/Sales/_SelectCurrentFuelSales", {
        sort: "", group: "", filter: "", ReportID: "545", FromDate, ToDate,
      });
      for (const raw of fuel) {
        const r = raw as Record<string, unknown>;
        const grade = mapFuelType(String(r.FuelType ?? "Regular"));
        const gallons = num(r.Volume);
        const price = num(r.Retail) || num(r.RptRetail);
        const cash = num(r.AmountCash);
        const card = num(r.AmountCreditDebit);
        const total = num(r.Amount) || cash + card;
        for (const [pay, amt] of splits(cash, card, total)) {
          out.push({
            date: day,
            category: "FUEL",
            paymentType: pay,
            amount: amt,
            note: `Modisoft ${String(r.FuelType ?? "")}`.trim(),
            fuel: { grade, gallons: share(gallons, amt, total), pricePerGallon: price, taxPerGallon: 0 },
          });
        }
      }

      // ---- Store / departments (ReportID 554) ----
      const dept = await post(cookie, "/Sales/_SelectCurrentPOSDeptSales", {
        sort: "", group: "", filter: "", ReportID: "554", FromDate, ToDate,
      });
      for (const raw of dept) {
        const r = raw as Record<string, unknown>;
        const name = String(r.DeptName ?? "");
        const category = mapDeptToCategory(name);
        const cash = num(r.SalesCash);
        const card = num(r.SalesCreditDebit);
        const total = num(r.NetSales) || num(r.Sales) || cash + card;
        const refundTotal = num(r.Refund);
        for (const [pay, amt] of splits(cash, card, total)) {
          out.push({
            date: day,
            category,
            paymentType: pay,
            amount: amt,
            refund: total > 0 ? round2((refundTotal * amt) / total) : 0,
            note: `Modisoft ${name}`.trim(),
          });
        }
      }
    }

    return out;
  },
};

/** Set the active store in the session (POST /Home/ChangeStore). */
async function changeStore(cookie: string, id: string, ccode: string): Promise<void> {
  const res = await fetch(BASE + "/Home/ChangeStore", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      accept: "*/*",
      origin: BASE,
      referer: BASE + "/Home/SelectStore",
    },
    body: new URLSearchParams({ ID: id, CCode: ccode, IsLocked: "false", IsRedirectBilling: "false" }).toString(),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Modisoft session expired or unauthorized — refresh MODI_COOKIE.");
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    throw new Error("Modisoft store-select returned non-JSON (likely a login page) — refresh MODI_COOKIE.");
  }
}

async function post(cookie: string, path: string, body: Record<string, string>): Promise<unknown[]> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      accept: "application/json, text/javascript, */*; q=0.01",
      origin: BASE,
      referer: BASE + "/",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Modisoft session expired or unauthorized — refresh MODI_COOKIE.");
  }
  if (!res.ok) throw new Error(`Modisoft ${path} responded ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    // Most likely an HTML login page → the cookie isn't valid.
    throw new Error("Modisoft returned a non-JSON response (likely a login page) — refresh MODI_COOKIE.");
  }
  const data = (await res.json()) as { Data?: unknown[] };
  return Array.isArray(data.Data) ? data.Data : [];
}

/** Whole days from `since` (inclusive) up to today, capped at 31. */
function daysFrom(since: Date): Date[] {
  const out: Date[] = [];
  const start = new Date(since); start.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cur = new Date(start);
  let guard = 0;
  while (cur <= today && guard < 31) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return out;
}

function fmtDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}
function num(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function splits(cash: number, card: number, total: number): ["CASH" | "CARD", number][] {
  if (cash > 0 || card > 0) {
    const r: ["CASH" | "CARD", number][] = [];
    if (cash > 0) r.push(["CASH", round2(cash)]);
    if (card > 0) r.push(["CARD", round2(card)]);
    return r;
  }
  return total > 0 ? [["CARD", round2(total)]] : [];
}
function share(totalGallons: number, sliceAmount: number, totalAmount: number): number {
  if (totalAmount <= 0) return round2(totalGallons);
  return round2((totalGallons * sliceAmount) / totalAmount);
}
