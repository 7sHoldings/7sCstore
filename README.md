# FuelTrack — Gas Station Business Reporting

A single web application where a gas-station owner can record and understand the
financial performance of the station — **sales, expenses, product purchases, and
profit** — on a daily, weekly, monthly, and yearly basis.

This is the **Phase 1** build per the SRS: a reporting/bookkeeping tool with
manual + CSV data entry, calculations, dashboards, reports, user roles, and
alerts. It is intentionally architected so a **Modi POS API feed can be added
later** without rebuilding (every record carries a `source`, and all numbers
flow through one calculation engine).

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS with the **FuelMetrics** design tokens (from the Stitch design export) |
| Database | Prisma ORM + SQLite (dev) — switch the provider to Postgres for production |
| Auth | bcrypt password hashing + signed JWT in an httpOnly cookie + edge middleware |
| Exports | `exceljs` (Excel) and `pdfkit` (PDF) |

## Getting started

```bash
npm install          # installs deps + generates the Prisma client
cp .env.example .env # set DATABASE_URL and AUTH_SECRET
npm run db:push      # create the SQLite schema
npm run db:seed      # load a location, users, and ~60 days of demo data
npm run dev          # http://localhost:3000
```

### Demo logins (password `password123`)

| Role | Email |
|---|---|
| Owner / Admin | `owner@fueltrack.app` |
| Manager | `manager@fueltrack.app` |
| Accountant | `accountant@fueltrack.app` |
| Employee | `employee@fueltrack.app` |

## Architecture

```
src/
  lib/
    calc.ts          # Calculation engine — SRS §3 formulas, exact (unit-verified)
    reports.ts       # Bridges the DB to the calc engine (dashboard + reports)
    reportBuilder.ts # Structured report docs shared by preview + Excel + PDF
    export/          # exceljs + pdfkit generators
    auth.ts          # bcrypt + JWT session
    rbac.ts          # Permission matrix (SRS §4.11)
    period.ts        # Daily/weekly/monthly/yearly date ranges
    alerts.ts        # Live alert evaluation against owner thresholds
    csv.ts           # CSV parser + import template
  app/
    login/           # Auth
    (app)/           # Authenticated shell + all feature pages
    api/export/      # PDF / Excel download endpoint
    api/import/      # CSV template download
  components/        # Shared UI (cards, charts, modal, filters, nav)
prisma/
  schema.prisma      # Full data model (SRS §5), multi-location ready
  seed.ts            # Demo data
```

### The integration-layer seam (FR-41)

Every transactional record has a `source` field (`MANUAL`, `CSV_IMPORT`,
`POS_MODI`). Reports and the dashboard never query a data source directly — they
go through `reports.ts` → `calc.ts`. Adding the Modi POS feed in Phase 2 means
writing rows with `source = POS_MODI`; **no report or calculation changes.**

## Requirement coverage (Phase 1 MUST/SHOULD)

| Area | Requirements | Where |
|---|---|---|
| Dashboard | FR-1…FR-7 | `app/(app)/dashboard` |
| Sales tracking | FR-8…FR-14 | `app/(app)/sales` |
| Shift reconciliation | FR-15…FR-17 | `calc.ts` `shiftReconciliation` + `Shift` model |
| Expenses | FR-18…FR-21 | `app/(app)/expenses` |
| Purchases / vendors | FR-22…FR-25 | `app/(app)/purchases`, `app/(app)/vendors` |
| Inventory (light) | FR-26…FR-28 | `app/(app)/inventory` |
| Profit calculation | FR-29…FR-32 | `lib/calc.ts` |
| Reports + PDF/Excel | FR-33…FR-35 | `app/(app)/reports`, `api/export` |
| Alerts | FR-36…FR-39 | `app/(app)/alerts`, `lib/alerts.ts` |
| CSV import / integration layer | FR-40, FR-41 | `app/(app)/import`, `source` field |
| Users / roles / audit | FR-44…FR-46 | `app/(app)/users`, `rbac.ts`, `audit.ts` |

### Key definitions (SRS §3) — implemented exactly

- **Gross Sales** excludes sales tax; **Sales Tax Collected** is tracked
  separately as a liability.
- **Net Sales** = Gross − refunds/voids.
- **Gross Profit** = Net Sales − COGS; **Net Profit** = Gross Profit − OpEx.
- **Fuel margin/gal** = pump price − (cost/gal + tax/gal); profit is per grade.
- **Lottery** = commission income only.

Money is rounded to 2 decimals; $/gallon to 4 (NFR-2). These are covered by the
checks in the development notes and re-run easily with `tsx`.

## Out of scope (Phase 1)

Modi POS auto-sync, email/SMS delivery, multi-location UI, bank import, payroll,
and tax filing are explicitly deferred (SRS §1.3, §7, §8). The data model and
integration seam are already prepared for them.
