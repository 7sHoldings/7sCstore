/**
 * Integration-layer contracts (FR-41). A POS adapter normalizes an external
 * feed into NormalizedSale rows; the sync runner persists them with
 * source = POS_MODI. Reports and calculations never know which adapter ran.
 */

export interface NormalizedSale {
  date: Date;
  category: "FUEL" | "STORE" | "LOTTERY" | "TOBACCO" | "FOOD_DRINK" | "OTHER";
  paymentType: "CASH" | "CARD" | "CHECK" | "OTHER";
  amount: number;
  taxCollected?: number;
  refund?: number;
  /** Promotion amount deducted from this row's gross sales (for display). */
  promotion?: number;
  note?: string;
  fuel?: {
    grade: "REGULAR" | "MID" | "PREMIUM" | "DIESEL";
    gallons: number;
    pricePerGallon: number;
    costPerGallon?: number;
    taxPerGallon?: number;
  };
}

/** A single inventory item pulled from the POS item-wise inventory report. */
export interface NormalizedInventoryItem {
  posItemId: number; // Modisoft ItemKey — stable match key
  posDeptId?: number; // Modisoft merchandise department id — required to push prices back
  upc: string;
  name: string;
  category: "FUEL" | "STORE" | "LOTTERY" | "TOBACCO" | "FOOD_DRINK" | "OTHER";
  department?: string;
  unitsPerCase: number;
  unitCost: number; // POS Cost (often 0 — POS doesn't track cost here)
  retailPrice: number;
  qtyOnHand: number; // POS qty (often 0/negative — POS stock not maintained)
  /**
   * Units sold within the requested window, when the report gives one.
   * Distinct from qtyOnHand on purpose: that field is a running stock level and
   * carries the same lifetime figure whatever dates are asked for, so using it
   * as period sales turns a lifetime total into a weekly forecast.
   */
  soldInPeriod?: number;
}

/** A request to set a new retail price on one POS item (scoped to its dept). */
export interface PricepushRequest {
  posItemId: number;
  posDeptId: number;
  newRetail: number;
}

/** The per-item result of a price push. */
export interface PricePushResult {
  posItemId: number;
  ok: boolean;
  oldPrice: number | null;
  skipped?: boolean; // POS already at this price — nothing sent
  error?: string;
}

export interface PosAdapter {
  /** Stable identifier, e.g. "POS_MODI". */
  readonly id: string;
  readonly label: string;
  /** Whether the adapter has the config it needs to talk to the POS. */
  isConfigured(): boolean;
  /**
   * Pull the item-wise inventory. Given a date window, quantities are reported
   * for that window — which is how units-sold-over-N-days is obtained.
   */
  fetchInventory?(from?: Date, to?: Date): Promise<NormalizedInventoryItem[]>;
  /** Push a new retail price to the POS for one item (scoped to its merchandise dept). */
  pushItemPrice?(req: PricepushRequest): Promise<PricePushResult>;
  /** Push new retail prices for many items at once (grouped by dept for efficiency). */
  pushItemPricesBulk?(reqs: PricepushRequest[]): Promise<PricePushResult[]>;
  /** Pull sales recorded at/after `since`. */
  fetchSince(since: Date): Promise<NormalizedSale[]>;
  /** Pull sales for an explicit [from, to] day range (used for backfill). */
  fetchRange?(from: Date, to: Date): Promise<NormalizedSale[]>;
  /** Pull per-hour sales totals per day (24 values, index 0=12AM…23=11PM). */
  fetchHourly?(from: Date, to: Date): Promise<DailyHourly[]>;
  /** Pull the customer/transaction count per day. */
  fetchCustomers?(from: Date, to: Date): Promise<{ date: string; customers: number }[]>;
  /** Pull the real sales-tax collected per day (from the POS-closing report). */
  fetchTax?(from: Date, to: Date): Promise<{ date: string; tax: number }[]>;
  /** Pull the actual tender per day: cash = Safe Drop, card = Credit Card Jobber (Batch). */
  fetchTender?(from: Date, to: Date): Promise<{ date: string; cash: number; card: number }[]>;
}

export interface DailyHourly {
  date: string; // YYYY-MM-DD
  hours: number[]; // length 24
  customers?: number; // transaction/customer count for the day
}
