/**
 * Sales projection for the running month and the month after, from the months
 * already seen plus last year's shape when there is one.
 *
 *  - Running month: the pace so far (sales ÷ days done × days in month). When
 *    last year has both months, that is averaged with "last month × how much
 *    last year moved between the same two months" — so a soda that always
 *    drops in November is not projected at October's pace.
 *  - Next month: this month (or its projection) × last year's change between
 *    the same two months (summer → winter etc.). Without last-year data it is
 *    carried flat, and the page says so.
 */
export interface ProjectionInput {
  values: number[]; // oldest → newest; the last one is the selected month
  running: { done: number; total: number } | null; // selected month still in progress
  lastYear: { prev: number; cur: number; next: number } | null; // same months a year ago
}

export interface Projection {
  current: number | null; // full-month projection of the running month
  next: number | null; // projection for the month after
  seasonal: boolean; // true when last year's pattern was used
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function project({ values, running, lastYear }: ProjectionInput): Projection {
  const n = values.length;
  if (!n) return { current: null, next: null, seasonal: false };
  const last = values[n - 1];
  const prev = n > 1 ? values[n - 2] : null;
  let seasonal = false;

  let current: number | null = null;
  if (running) {
    if (running.done <= 0) return { current: null, next: null, seasonal: false };
    const pace = (last / running.done) * running.total;
    if (lastYear && lastYear.prev > 0 && prev !== null && prev !== 0) {
      current = (pace + prev * (lastYear.cur / lastYear.prev)) / 2;
      seasonal = true;
    } else {
      current = pace;
    }
  }

  const base = running ? current! : last;
  let next = base;
  if (lastYear && lastYear.cur > 0) {
    next = base * (lastYear.next / lastYear.cur);
    seasonal = true;
  }
  return { current: current === null ? null : r2(current), next: r2(next), seasonal };
}
