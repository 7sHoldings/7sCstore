/**
 * Integration-layer contracts (FR-41). A POS adapter normalizes an external
 * feed into NormalizedSale rows; the sync runner persists them with
 * source = POS_MODI. Reports and calculations never know which adapter ran.
 */

export interface NormalizedSale {
  date: Date;
  category: "FUEL" | "STORE" | "LOTTERY" | "TOBACCO" | "FOOD_DRINK" | "OTHER";
  paymentType: "CASH" | "CARD" | "OTHER";
  amount: number;
  taxCollected?: number;
  refund?: number;
  note?: string;
  fuel?: {
    grade: "REGULAR" | "MID" | "PREMIUM" | "DIESEL";
    gallons: number;
    pricePerGallon: number;
    costPerGallon?: number;
    taxPerGallon?: number;
  };
}

export interface PosAdapter {
  /** Stable identifier, e.g. "POS_MODI". */
  readonly id: string;
  readonly label: string;
  /** Whether the adapter has the config it needs to talk to the POS. */
  isConfigured(): boolean;
  /** Pull sales recorded at/after `since`. */
  fetchSince(since: Date): Promise<NormalizedSale[]>;
  /** Pull sales for an explicit [from, to] day range (used for backfill). */
  fetchRange?(from: Date, to: Date): Promise<NormalizedSale[]>;
  /** Pull per-hour sales totals per day (24 values, index 0=12AM…23=11PM). */
  fetchHourly?(from: Date, to: Date): Promise<DailyHourly[]>;
}

export interface DailyHourly {
  date: string; // YYYY-MM-DD
  hours: number[]; // length 24
  customers?: number; // transaction/customer count for the day
}
