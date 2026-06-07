import type { PosAdapter, NormalizedSale, DailyHourly } from "./types";
import { mapFuelType, mapDeptToCategory } from "./modiMap";

const HOUR_LABELS = ["12 AM","1 AM","2 AM","3 AM","4 AM","5 AM","6 AM","7 AM","8 AM","9 AM","10 AM","11 AM","12 PM","1 PM","2 PM","3 PM","4 PM","5 PM","6 PM","7 PM","8 PM","9 PM","10 PM","11 PM"];

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

// Cloudflare's cf_clearance cookie is bound to the browser's User-Agent, so we
// send a matching one. Override with MODI_USER_AGENT if your browser differs.
const UA =
  process.env.MODI_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

export const modiInsightsAdapter: PosAdapter = {
  id: "POS_MODI",
  label: "Modisoft (Insights session)",
  isConfigured: () => Boolean(process.env.MODI_COOKIE),

  async fetchSince(since: Date): Promise<NormalizedSale[]> {
    return this.fetchRange!(since, new Date());
  },

  async fetchRange(from: Date, to: Date): Promise<NormalizedSale[]> {
    const cookie = process.env.MODI_COOKIE!;
    const storeId = process.env.MODI_STORE_ID || "16";
    const ccode = process.env.MODI_CCODE || "854388";
    const out: NormalizedSale[] = [];

    // Select the store in the session first so the report endpoints scope to it.
    await changeStore(cookie, storeId, ccode);

    for (const day of daysBetween(from, to)) {
      const FromDate = `${fmtDate(day)} 12:00 AM`;
      const ToDate = `${fmtDate(day)} 11:59 PM`;

      // Establish the POS-Closing (report 635) context for this day + store.
      await setupReport(cookie, "/ebreports/report635html", {
        FromDate, ToDate, DeptID: "-1", Stores: storeId,
      });

      // Authoritative daily totals come from the POS-Closing report (635), which
      // matches what the owner sees on screen. It has no cash/card split, so we
      // derive a cash ratio from the Card & Cash Closing report (554).
      const [grocery, fuel, currentDept] = await Promise.all([
        post(cookie, "/Sales/_SelectGroceryDeptSales", { sort: "", group: "", filter: "", ReportID: "635", DeptID: "-1", FromDate, ToDate }),
        post(cookie, "/Sales/_SelectFuelSales", { sort: "", group: "", filter: "", ReportID: "635", DeptID: "-1", FromDate, ToDate }),
        post(cookie, "/Sales/_SelectCurrentPOSDeptSales", { sort: "", group: "", filter: "", ReportID: "554", FromDate, ToDate }).catch(() => [] as unknown[]),
      ]);

      const cashRatio = computeCashRatio(currentDept);

      // ---- Store / department sales (635) ----
      for (const raw of grocery) {
        const r = raw as Record<string, unknown>;
        const name = String(r.DeptName ?? "");
        const category = mapDeptToCategory(name);
        const amount = num(r.Sales); // report "Sales" column; can be negative (e.g. LOTTO P\O)
        if (amount === 0) continue;
        const refundTotal = num(r.Refund);
        for (const [pay, amt] of splitAmount(amount, cashRatio)) {
          out.push({
            date: day,
            category,
            paymentType: pay,
            amount: amt,
            refund: amount !== 0 ? round2((refundTotal * amt) / amount) : 0,
            note: `Modisoft ${name}`.trim(),
          });
        }
      }

      // ---- Fuel sales (635) ----
      for (const raw of fuel) {
        const r = raw as Record<string, unknown>;
        const grade = mapFuelType(String(r.FuelType ?? "Regular"));
        const gallons = num(r.Volume);
        const price = num(r.RptRetail) || num(r.Retail);
        const amount = num(r.Amount);
        if (amount === 0 && gallons === 0) continue;
        for (const [pay, amt] of splitAmount(amount, cashRatio)) {
          out.push({
            date: day,
            category: "FUEL",
            paymentType: pay,
            amount: amt,
            note: `Modisoft ${String(r.FuelType ?? "")}`.trim(),
            fuel: { grade, gallons: share(gallons, amt, amount), pricePerGallon: price, taxPerGallon: 0 },
          });
        }
      }

      await sleep(120); // be gentle on Cloudflare during long backfills
    }

    return out;
  },

  async fetchHourly(from: Date, to: Date): Promise<DailyHourly[]> {
    const cookie = process.env.MODI_COOKIE!;
    const storeId = process.env.MODI_STORE_ID || "16";
    const ccode = process.env.MODI_CCODE || "854388";
    await changeStore(cookie, storeId, ccode);

    const out: DailyHourly[] = [];
    for (const day of daysBetween(from, to)) {
      const FromDate = `${fmtDate(day)} 12:00 AM`;
      const ToDate = `${fmtDate(day)} 11:59 PM`;
      try {
        const [rows, cashiers] = await Promise.all([
          postArray(cookie, "/SnapShot/GroceryHourlySales", {
            sort: "", group: "", filter: "", ReportID: "635", DeptID: "-1", FromDate, ToDate,
          }),
          post(cookie, "/Sales/_SelectCurrentCashRegister", {
            sort: "", group: "", filter: "", ReportID: "635", DeptID: "-1", FromDate, ToDate,
          }).catch(() => [] as unknown[]),
        ]);
        const hours = new Array(24).fill(0);
        for (const raw of rows) {
          const r = raw as Record<string, unknown>;
          const idx = HOUR_LABELS.indexOf(String(r.TimeString ?? ""));
          if (idx >= 0) hours[idx] = round2(num(r.Sales));
        }
        const customers = cashiers.reduce<number>((s, raw) => s + num((raw as Record<string, unknown>).NoOfCustomer), 0);
        out.push({ date: day.toISOString().slice(0, 10), hours, customers });
      } catch {
        // hourly is best-effort; skip the day on error
      }
      await sleep(80);
    }
    return out;
  },
};

/** Overall cash share from the Card & Cash Closing report rows (0..1, or null). */
function computeCashRatio(rows: unknown[]): number | null {
  let cash = 0;
  let card = 0;
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    cash += num(r.SalesCash);
    card += num(r.SalesCreditDebit);
  }
  const tot = cash + card;
  return tot > 0 ? cash / tot : null;
}

/** Split a (possibly negative) amount into CASH/CARD by ratio; CARD-only if unknown. */
function splitAmount(amount: number, cashRatio: number | null): ["CASH" | "CARD", number][] {
  if (cashRatio === null) return [["CARD", round2(amount)]];
  const cash = round2(amount * cashRatio);
  const card = round2(amount - cash);
  const out: ["CASH" | "CARD", number][] = [];
  if (cash !== 0) out.push(["CASH", cash]);
  if (card !== 0) out.push(["CARD", card]);
  return out.length ? out : [["CARD", 0]];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fire a report-setup POST (HTML response); validates the session is alive. */
async function setupReport(cookie: string, path: string, body: Record<string, string>): Promise<void> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": UA,
      accept: "text/html, */*; q=0.01",
      origin: BASE,
      referer: BASE + "/",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Modisoft session expired or unauthorized — refresh MODI_COOKIE.");
  }
}

/** Set the active store in the session (POST /Home/ChangeStore). */
async function changeStore(cookie: string, id: string, ccode: string): Promise<void> {
  const res = await fetch(BASE + "/Home/ChangeStore", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": UA,
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
      "user-agent": UA,
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

/** POST that returns a top-level JSON array (e.g. GroceryHourlySales). */
async function postArray(cookie: string, path: string, body: Record<string, string>): Promise<unknown[]> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": UA,
      accept: "application/json, text/javascript, */*; q=0.01",
      origin: BASE,
      referer: BASE + "/",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Modisoft ${path} responded ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) throw new Error("non-json");
  const data = await res.json();
  return Array.isArray(data) ? data : Array.isArray(data?.Data) ? data.Data : [];
}

/** Whole days from `from` to `to` (inclusive), capped at 60 per call. */
function daysBetween(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const start = new Date(from); start.setHours(0, 0, 0, 0);
  const end = new Date(to); end.setHours(0, 0, 0, 0);
  const cur = new Date(start);
  let guard = 0;
  while (cur <= end && guard < 60) {
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
function share(totalGallons: number, sliceAmount: number, totalAmount: number): number {
  if (totalAmount === 0) return round2(totalGallons);
  return round2((totalGallons * sliceAmount) / totalAmount);
}
