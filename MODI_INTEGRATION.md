# Modisoft POS Integration

We're integrating via Modisoft's **official API** (chosen over scraping the
`insights1.modisoft.com` web backend, which only has a login-session cookie and
no key). This doc records what we learned from the HAR captures and what's needed
to finish.

## What the HAR captures showed

Source: `insights1.modisoft.com` (Insights web reporting backend). Useful JSON
endpoints and their fields:

- **Fuel** — `/Sales/_SelectCurrentFuelSales`
  `FuelType` (Regular/Plus/V Power/Diesel), `Volume` (gallons), `Retail`/`RptRetail`
  ($/gal), `Amount`, `AmountCash`, `AmountCreditDebit`, `DiscountAmount`.
- **Store** — `/Sales/_SelectCurrentPOSDeptSales`, `/Sales/_SelectGroceryDeptSales`
  `DeptName` (CIGARETTES, BEER, CANDY, …), `Sales`, `SalesCash`,
  `SalesCreditDebit`, `Refund`, `NetSales`.
- **Cash register** — `/Sales/_SelectCurrentCashRegister` (cashier/customer counts).
- Params: `FromDate` / `ToDate` (`MM/DD/YYYY hh:mm AM/PM`), `Stores`, `ReportID`.
- Auth: **session cookie only** (no API key/token) — hence the official-API route.

## Field mapping (already implemented)

`src/lib/integrations/modiMap.ts`:
- `mapFuelType("Regular"|"Plus"|"V Power"|"Diesel")` → `REGULAR | MID | PREMIUM | DIESEL`
- `mapDeptToCategory("CIGARETTES"|"BEER"|…)` → `TOBACCO | FOOD_DRINK | LOTTERY | STORE | FUEL`
- cash/credit dollar splits → separate CASH / CARD `Sale` rows

The adapter (`src/lib/integrations/modi.ts`) consumes a `{ fuel: [], departments: [] }`
shape and writes `Sale` / `FuelSale` rows tagged `source = POS_MODI`. Reports and
the dashboard pick them up automatically.

## What to request from Modisoft (to finish)

Contact your Modisoft account rep / support and ask for **API access**, then send
me:

1. **API base URL** (e.g. `https://api.modisoft.com/v1`).
2. **Authentication** — API key / bearer token (and which header), or OAuth.
3. **Endpoint(s)** for fuel sales and department/store sales (and the date params).
4. **A sample JSON response** from each (one day is enough) — this is the key item.
5. **Store identifier** to scope the data (your `Stores` value, e.g. `16`).

## Finishing steps (once you have the above)

1. I align `modi.ts` field names/request shape to the official API (quick, since
   the value mappings are done) and confirm against your sample response.
2. In **Vercel → Environment Variables** add:
   - `MODI_API_URL`, `MODI_API_KEY`, and optionally `MODI_STORE_ID`.
3. Redeploy. On **Integrations → "Sync now"**, the live adapter activates
   automatically (it shows "Live" instead of "Sandbox"), pulls the data, logs the
   run, and raises an alert on failure.
4. A scheduled job can call the same `runSync()` for automatic daily syncing.
