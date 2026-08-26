import type { PosAdapter, NormalizedSale, NormalizedInventoryItem, PricepushRequest, PricePushResult } from "./types";
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
// The inventory endpoints were observed on insights.modisoft.com (cookies are
// shared across *.modisoft.com). Override with MODI_INV_BASE if needed.
const INV_BASE = process.env.MODI_INV_BASE || "https://insights.modisoft.com";

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
      // take the per-department / per-grade cash ratio from the Card & Cash
      // Closing reports (554 dept, 545 fuel) and apply it to the 635 totals.
      const [grocery, fuel, currentDept, currentFuel] = await Promise.all([
        post(cookie, "/Sales/_SelectGroceryDeptSales", { sort: "", group: "", filter: "", ReportID: "635", DeptID: "-1", FromDate, ToDate }),
        post(cookie, "/Sales/_SelectFuelSales", { sort: "", group: "", filter: "", ReportID: "635", DeptID: "-1", FromDate, ToDate }),
        post(cookie, "/Sales/_SelectCurrentPOSDeptSales", { sort: "", group: "", filter: "", ReportID: "554", FromDate, ToDate }).catch(() => [] as unknown[]),
        post(cookie, "/Sales/_SelectCurrentFuelSales", { sort: "", group: "", filter: "", ReportID: "545", FromDate, ToDate }).catch(() => [] as unknown[]),
      ]);

      // Per-department cash ratio (from 554) + overall fallback.
      const deptRatio = new Map<string, number | null>();
      let oCash = 0, oCard = 0;
      for (const raw of currentDept) {
        const r = raw as Record<string, unknown>;
        const cash = num(r.SalesCash);
        const card = num(r.SalesCreditDebit);
        oCash += cash; oCard += card;
        deptRatio.set(String(r.DeptName ?? "").trim().toUpperCase(), cash + card > 0 ? cash / (cash + card) : null);
      }
      const overallRatio = oCash + oCard > 0 ? oCash / (oCash + oCard) : null;

      // Per-grade fuel cash ratio (from 545) + fuel overall fallback.
      const fuelRatio = new Map<string, number | null>();
      let fCash = 0, fCard = 0;
      for (const raw of currentFuel) {
        const r = raw as Record<string, unknown>;
        const cash = num(r.AmountCash);
        const card = num(r.AmountCreditDebit);
        fCash += cash; fCard += card;
        fuelRatio.set(String(r.FuelType ?? "").trim().toUpperCase(), cash + card > 0 ? cash / (cash + card) : null);
      }
      const fuelOverall = fCash + fCard > 0 ? fCash / (fCash + fCard) : overallRatio;

      // ---- Store / department sales (635 totals, 554 per-dept split) ----
      for (const raw of grocery) {
        const r = raw as Record<string, unknown>;
        const name = String(r.DeptName ?? "");
        const category = mapDeptToCategory(name);
        // Net of discounts & promotions: prefer the report's NetSales, else
        // Sales − Discount − Promotion. Can be negative (e.g. LOTTO P\O).
        const amount =
          r.NetSales != null ? num(r.NetSales) : num(r.Sales) - num(r.Discount) - num(r.Promotion);
        if (amount === 0) continue;
        const refundTotal = num(r.Refund);
        const promoTotal = num(r.Promotion);
        const ratio = deptRatio.get(name.trim().toUpperCase()) ?? overallRatio;
        for (const [pay, amt] of splitAmount(amount, ratio)) {
          out.push({
            date: day,
            category,
            paymentType: pay,
            amount: amt,
            refund: amount !== 0 ? round2((refundTotal * amt) / amount) : 0,
            promotion: amount !== 0 ? round2((promoTotal * amt) / amount) : 0,
            note: `Modisoft ${name}`.trim(),
          });
        }
      }

      // ---- Fuel sales (635 totals, 545 per-grade split) ----
      for (const raw of fuel) {
        const r = raw as Record<string, unknown>;
        const fuelType = String(r.FuelType ?? "Regular");
        const grade = mapFuelType(fuelType);
        const gallons = num(r.Volume);
        const price = num(r.RptRetail) || num(r.Retail);
        const amount = num(r.Amount);
        if (amount === 0 && gallons === 0) continue;
        // Fuel "promotions" = the report's Discount Amount (+ any Promotion).
        const promoTotal = (num(r.Discount) || num(r.DiscountAmount)) + num(r.Promotion);
        const ratio = fuelRatio.get(fuelType.trim().toUpperCase()) ?? fuelOverall;
        for (const [pay, amt] of splitAmount(amount, ratio)) {
          out.push({
            date: day,
            category: "FUEL",
            paymentType: pay,
            amount: amt,
            promotion: amount !== 0 ? round2((promoTotal * amt) / amount) : 0,
            note: `Modisoft ${fuelType}`.trim(),
            fuel: { grade, gallons: share(gallons, amt, amount), pricePerGallon: price, taxPerGallon: 0 },
          });
        }
      }

      await sleep(120); // be gentle on Cloudflare during long backfills
    }

    return out;
  },

  async fetchCustomers(from: Date, to: Date): Promise<{ date: string; customers: number }[]> {
    const cookie = process.env.MODI_COOKIE!;
    const storeId = process.env.MODI_STORE_ID || "16";
    const ccode = process.env.MODI_CCODE || "854388";
    await changeStore(cookie, storeId, ccode);

    const out: { date: string; customers: number }[] = [];
    for (const day of daysBetween(from, to)) {
      const FromDate = `${fmtDate(day)} 12:00 AM`;
      const ToDate = `${fmtDate(day)} 11:59 PM`;
      try {
        const cashiers = await post(cookie, "/Sales/_SelectCurrentCashRegister", {
          sort: "", group: "", filter: "", ReportID: "635", DeptID: "-1", FromDate, ToDate,
        });
        const customers = cashiers.reduce<number>((s, raw) => s + num((raw as Record<string, unknown>).NoOfCustomer), 0);
        out.push({ date: day.toISOString().slice(0, 10), customers });
      } catch {
        // best-effort; skip the day on error
      }
      await sleep(80);
    }
    return out;
  },

  async fetchTax(from: Date, to: Date): Promise<{ date: string; tax: number }[]> {
    const cookie = process.env.MODI_COOKIE!;
    const storeId = process.env.MODI_STORE_ID || "16";
    const ccode = process.env.MODI_CCODE || "854388";
    await changeStore(cookie, storeId, ccode);

    // Sales Tax comes from the SAME Daily Entry financial (EBDaily) that gives us
    // the cash (Safe Drop) and card (Batch) totals — it lists a "Sales Tax" tran
    // type alongside them. This is what the owner sees on the POS Closing screen.
    const out: { date: string; tax: number }[] = [];
    for (const day of daysBetween(from, to)) {
      try {
        const groups = await post(cookie, "/EBDaily/_SelectPOSFinancial", {
          sort: "", page: "1", pageSize: "100", group: "TranTypeName-asc",
          aggregate: "Amount-sum", filter: "", COAID: "-1",
          CTDate: fmtDateShort(day), Shift: "-1", ExpType: "1",
        });
        let salesTax: number | null = null, taxAlt: number | null = null;
        for (const raw of groups) {
          const g = raw as { Key?: unknown; Aggregates?: { Amount?: { Sum?: unknown } } };
          const key = String(g.Key ?? "").trim().toLowerCase();
          const sum = num(g.Aggregates?.Amount?.Sum);
          if (key.includes("sales tax")) salesTax = sum;
          else if (key === "tax") taxAlt = sum;
        }
        const tax = salesTax ?? taxAlt;
        if (tax != null) out.push({ date: day.toISOString().slice(0, 10), tax: round2(tax) });
      } catch {
        // best-effort; skip the day on error
      }
      await sleep(120);
    }
    return out;
  },

  async fetchTender(from: Date, to: Date): Promise<{ date: string; cash: number; card: number }[]> {
    const cookie = process.env.MODI_COOKIE!;
    const storeId = process.env.MODI_STORE_ID || "16";
    const ccode = process.env.MODI_CCODE || "854388";
    await changeStore(cookie, storeId, ccode);

    // The Daily Entry financial (EBDaily) groups the day's transactions by type.
    // The owner reconciles cash from the "Safe Drop" total and credit-card from
    // the "Batch" total (shown as "Credit Card Jobber" on the Daily Entry screen).
    const out: { date: string; cash: number; card: number }[] = [];
    for (const day of daysBetween(from, to)) {
      try {
        const groups = await post(cookie, "/EBDaily/_SelectPOSFinancial", {
          sort: "", page: "1", pageSize: "100", group: "TranTypeName-asc",
          aggregate: "Amount-sum", filter: "", COAID: "-1",
          CTDate: fmtDateShort(day), Shift: "-1", ExpType: "1",
        });
        let cash = 0, card = 0;
        for (const raw of groups) {
          const g = raw as { Key?: unknown; Aggregates?: { Amount?: { Sum?: unknown } } };
          const key = String(g.Key ?? "").trim().toLowerCase();
          const sum = num(g.Aggregates?.Amount?.Sum);
          if (key === "safe drop") cash = sum;
          else if (key === "batch") card = sum;
        }
        out.push({ date: day.toISOString().slice(0, 10), cash: round2(cash), card: round2(card) });
      } catch {
        // best-effort; skip the day on error
      }
      await sleep(120);
    }
    return out;
  },

  async fetchInventory(from?: Date, to?: Date): Promise<NormalizedInventoryItem[]> {
    const cookie = process.env.MODI_COOKIE!;
    const storeId = process.env.MODI_STORE_ID || "16";
    const ccode = process.env.MODI_CCODE || "854388";
    await changeStore(cookie, storeId, ccode, INV_BASE);

    // Map a department/tax-department id → name → our category. Best-effort.
    const deptById = await loadDepartments(cookie);

    // The item-wise report is date-ranged and reports quantities for the window
    // asked for. Defaulting to today preserves the original behaviour; a wider
    // window turns the same call into "units sold over N days", which is what
    // demand forecasting needs.
    const fromStr = fmtDate(from ?? new Date());
    const toStr = fmtDate(to ?? new Date());
    const pageSize = 1000;
    const out: NormalizedInventoryItem[] = [];
    let page = 1;
    let total = Infinity;
    while ((page - 1) * pageSize < total && page <= 100) {
      const { data, total: t } = await postGrid(cookie, "/Product/_SelectInventoryItemWise", {
        sort: "UPC-asc", page: String(page), pageSize: String(pageSize), group: "", filter: "",
        FromDate: `${fromStr} 12:00 AM`, ToDate: `${toStr} 11:59 PM`,
        DateRangeType: "1", SearchValue: "", IsADJOnly: "false", IsActiveOnly: "false",
      }, INV_BASE);
      if (t > 0) total = t;
      for (const raw of data) {
        const r = raw as Record<string, unknown>;
        const posItemId = num(r.ItemKey);
        if (!posItemId) continue;
        const name = String(r.Description ?? "").trim();
        const deptName = String(r.DeptName ?? deptById.get(num(r.TaxDepart)) ?? "").trim();
        out.push({
          posItemId,
          upc: String(r.UPC ?? "").trim(),
          name: name || String(r.UPC ?? "").trim() || `Item ${posItemId}`,
          department: deptName || undefined,
          category: mapDeptToCategory(deptName),
          unitsPerCase: Math.max(1, Math.round(num(r.UnitsPerCase)) || 1),
          unitCost: num(r.Cost),
          retailPrice: num(r.Retail),
          qtyOnHand: num(r.CurrentRptQty),
        });
      }
      if (!data.length) break;
      page++;
      await sleep(80);
    }

    // Second pass: stamp each item with its MERCHANDISE department id. The
    // item-wise report only carries TaxDepart (tax dept ≠ the dept that scopes a
    // price update), so we walk each merchandise department's grid and map
    // ItemKey → deptId. Best-effort: items we can't place just can't be pushed.
    try {
      const byKey = new Map(out.map((it) => [it.posItemId, it]));
      for (const [deptId, deptName] of deptById) {
        const rows = await fetchDeptGrid(cookie, deptId, INV_BASE);
        for (const raw of rows) {
          const r = raw as Record<string, unknown>;
          const it = byKey.get(num(r.ItemKey));
          if (!it) continue;
          it.posDeptId = deptId;
          const dn = String(r.DeptName ?? deptName).trim();
          if (dn) { it.department = dn; it.category = mapDeptToCategory(dn); }
        }
        await sleep(50);
      }
    } catch {
      // best-effort; price-push stays disabled for unmapped items
    }

    return out;
  },

  async pushItemPrice(req: PricepushRequest): Promise<PricePushResult> {
    return (await this.pushItemPricesBulk!([req]))[0];
  },

  async pushItemPricesBulk(reqs: PricepushRequest[]): Promise<PricePushResult[]> {
    const cookie = process.env.MODI_COOKIE!;
    const storeId = process.env.MODI_STORE_ID || "16";
    const ccode = process.env.MODI_CCODE || "854388";
    await changeStore(cookie, storeId, ccode, INV_BASE);

    const today = fmtDate(new Date());
    const results: PricePushResult[] = [];

    // Group by department so each department's grid is fetched only once.
    const byDept = new Map<number, PricepushRequest[]>();
    for (const r of reqs) {
      if (!r.posDeptId) { results.push({ posItemId: r.posItemId, ok: false, oldPrice: null, error: "No POS department mapped — pull inventory again first." }); continue; }
      const list = byDept.get(r.posDeptId) ?? [];
      list.push(r);
      byDept.set(r.posDeptId, list);
    }

    for (const [deptId, items] of byDept) {
      let rowByKey: Map<number, Record<string, unknown>>;
      try {
        const rows = await fetchDeptGrid(cookie, deptId, INV_BASE);
        rowByKey = new Map(rows.map((raw) => [num((raw as Record<string, unknown>).ItemKey), raw as Record<string, unknown>]));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not load department.";
        for (const it of items) results.push({ posItemId: it.posItemId, ok: false, oldPrice: null, error: msg });
        continue;
      }

      for (const it of items) {
        const row = rowByKey.get(it.posItemId);
        if (!row) { results.push({ posItemId: it.posItemId, ok: false, oldPrice: null, error: "Item not found in its POS department." }); continue; }
        const oldPrice = round2(num(row.Retail));
        const newRetail = round2(it.newRetail);
        if (oldPrice === newRetail) { results.push({ posItemId: it.posItemId, ok: true, oldPrice, skipped: true }); continue; }
        try {
          await postForm(
            cookie,
            `/SnapShot/UpdateInventoryItemsDetails?ID=${deptId}&FromDate=${encodeURIComponent(today)}&SID=`,
            rowToForm(row, newRetail),
            INV_BASE
          );
          results.push({ posItemId: it.posItemId, ok: true, oldPrice });
        } catch (e) {
          results.push({ posItemId: it.posItemId, ok: false, oldPrice, error: e instanceof Error ? e.message : "Push failed." });
        }
        await sleep(120); // be gentle on Cloudflare between writes
      }
    }

    // Preserve caller order.
    const order = new Map(reqs.map((r, i) => [r.posItemId, i]));
    results.sort((a, b) => (order.get(a.posItemId) ?? 0) - (order.get(b.posItemId) ?? 0));
    return results;
  },
};

/** Load one merchandise department's inventory grid (paginated, all rows). */
async function fetchDeptGrid(cookie: string, deptId: number, base: string): Promise<unknown[]> {
  const today = fmtDate(new Date());
  const pageSize = 2000;
  const out: unknown[] = [];
  let page = 1;
  let total = Infinity;
  while ((page - 1) * pageSize < total && page <= 50) {
    const { data, total: t } = await postGrid(cookie, "/SnapShot/InventoryItemsDetails", {
      sort: "", page: String(page), pageSize: String(pageSize), group: "", filter: "",
      ID: String(deptId), FromDate: today, InvFilterFor: String(deptId),
    }, base);
    if (t > 0) total = t;
    out.push(...data);
    if (!data.length) break;
    page++;
    await sleep(40);
  }
  return out;
}

/** Serialize a Kendo grid row to form fields, overriding Retail with the new price. */
function rowToForm(row: Record<string, unknown>, newRetail: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) { out[k] = ""; continue; }
    if (typeof v === "object") continue; // skip nested objects/arrays Kendo doesn't post
    out[k] = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
  }
  out.Retail = String(newRetail);
  return out;
}

/** POST a form-urlencoded body and return the parsed JSON (or null). */
/**
 * Turn a failed response into an error that names the actual cause.
 *
 * A 401 and a 403 are different problems with different fixes, and collapsing
 * them into "session expired" sends people to re-copy a cookie that was never
 * the issue. Cloudflare in particular answers 403 when the request's
 * User-Agent doesn't match the browser the `cf_clearance` cookie was issued to,
 * so a freshly copied cookie fails exactly like a stale one.
 */
async function describeFailure(res: Response, path: string): Promise<Error> {
  const cfRay = res.headers.get("cf-ray");
  const mitigated = res.headers.get("cf-mitigated");
  let body = "";
  try { body = (await res.text()).slice(0, 400); } catch { /* body already consumed */ }
  const challenged =
    !!mitigated ||
    /just a moment|attention required|cf-browser-verification|challenge-platform/i.test(body);

  if (challenged) {
    return new Error(
      `Cloudflare blocked the request to ${path} (${res.status}${cfRay ? `, ray ${cfRay}` : ""}). ` +
        "This is usually the browser fingerprint, not the login: cf_clearance only works with " +
        "the exact User-Agent it was issued to. Copy your browser's User-Agent into " +
        "MODI_USER_AGENT, or re-copy the cookie from a browser matching the one already set."
    );
  }
  if (res.status === 401) {
    return new Error(`Modisoft rejected the login on ${path} (401) — MODI_COOKIE is no longer valid.`);
  }
  if (res.status === 403) {
    return new Error(
      `Modisoft refused the request to ${path} (403). The session may be valid but not permitted ` +
        "for this store, or the request was blocked upstream. Check MODI_STORE_ID and MODI_CCODE."
    );
  }
  if (res.status >= 500) {
    return new Error(`Modisoft returned a server error on ${path} (${res.status}). Nothing was read; try again shortly.`);
  }
  return new Error(`Modisoft ${path} responded ${res.status}.`);
}

/** A login page served in place of data means the session is not being accepted. */
function notJsonError(path: string, contentType: string | null): Error {
  return new Error(
    `Modisoft answered ${path} with ${contentType || "an unknown content type"} instead of JSON — ` +
      "typically a login page, meaning MODI_COOKIE is not being accepted."
  );
}

async function postForm(cookie: string, path: string, body: Record<string, string>, base: string): Promise<unknown> {
  const res = await fetch(base + path, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": UA,
      accept: "application/json, text/javascript, */*; q=0.01",
      origin: base,
      referer: base + "/",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw await describeFailure(res, path);if (!res.ok) throw await describeFailure(res, path);
  try { return await res.json(); } catch { return null; }
}

/** Department/tax-department id → name (for categorising item-wise rows). */
async function loadDepartments(cookie: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const res = await fetch(INV_BASE + "/Report/LoadDepartments?text=", {
      headers: { cookie, "x-requested-with": "XMLHttpRequest", "user-agent": UA, accept: "application/json, */*; q=0.01", referer: INV_BASE + "/" },
      cache: "no-store",
    });
    if (res.ok && (res.headers.get("content-type") || "").includes("json")) {
      const list = (await res.json()) as { Text?: string; Value?: string }[];
      for (const d of list) {
        const id = Number(d.Value);
        if (isFinite(id) && id > 0) map.set(id, String(d.Text ?? "").trim());
      }
    }
  } catch {
    // best-effort; categories fall back to STORE
  }
  return map;
}

/** POST a Kendo-grid endpoint and return both rows and the total row count. */
async function postGrid(cookie: string, path: string, body: Record<string, string>, base: string = BASE): Promise<{ data: unknown[]; total: number }> {
  const res = await fetch(base + path, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": UA,
      accept: "application/json, text/javascript, */*; q=0.01",
      origin: base,
      referer: base + "/",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw await describeFailure(res, path);if (!res.ok) throw await describeFailure(res, path);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) throw notJsonError(path, ct);
  const json = (await res.json()) as { Data?: unknown[]; Total?: number };
  return { data: Array.isArray(json.Data) ? json.Data : [], total: Number(json.Total) || 0 };
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
  if (res.status === 401 || res.status === 403) throw await describeFailure(res, path);
}

/** Set the active store in the session (POST /Home/ChangeStore). */
async function changeStore(cookie: string, id: string, ccode: string, base: string = BASE): Promise<void> {
  const res = await fetch(base + "/Home/ChangeStore", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": UA,
      accept: "*/*",
      origin: base,
      referer: base + "/Home/SelectStore",
    },
    body: new URLSearchParams({ ID: id, CCode: ccode, IsLocked: "false", IsRedirectBilling: "false" }).toString(),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw await describeFailure(res, "/Home/ChangeStore");
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    throw notJsonError("store-select", res.headers.get("content-type"));
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
  if (res.status === 401 || res.status === 403) throw await describeFailure(res, path);
  if (!res.ok) throw await describeFailure(res, path);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    // Most likely an HTML login page → the cookie isn't valid.
    throw new Error("Modisoft returned a non-JSON response (likely a login page) — refresh MODI_COOKIE.");
  }
  const data = (await res.json()) as { Data?: unknown[] };
  return Array.isArray(data.Data) ? data.Data : [];
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
/** Report-36 wants the date without leading zeros and without a time (e.g. 5/1/2026). */
function fmtDateShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
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
