/**
 * The three sizes an order can be placed at.
 *
 * Deliberately free of any server import: both the engine that computes the
 * quantities and the table that lets you switch between them need this, and the
 * table is a client component.
 *
 * Each version is the same forecast bought for a different slice of the cover
 * period, so lines stay comparable: a carton needing 3.8 for a full week comes
 * out at 4 / 3 / 2. Cases round up, so a one-case item stays one case in all
 * three — the versions trim what is big enough to trim.
 */
export type VersionKey = "full" | "balanced" | "lean";

export const ORDER_VERSIONS: {
  key: VersionKey;
  label: string;
  coverMultiplier: number;
  blurb: string;
}[] = [
  { key: "full", label: "Full", coverMultiplier: 1, blurb: "A whole cover period of forecast demand" },
  { key: "balanced", label: "Balanced", coverMultiplier: 0.7, blurb: "70% of it — trims the big lines, keeps the rest" },
  { key: "lean", label: "Lean", coverMultiplier: 0.5, blurb: "Half — buys the fastest movers, waits on the rest" },
];
