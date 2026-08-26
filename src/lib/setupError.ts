/**
 * Recognise the "table doesn't exist yet" failure.
 *
 * The production deploy script runs `prisma db push` but never fails the build,
 * so the app can ship against a database that is missing newer tables. Without
 * this the page dies with an opaque "server-side exception", which says nothing
 * about what to do. Pages use it to show what to run instead.
 */
export function isMissingTableError(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  // P2021 table does not exist · P2022 column does not exist
  if (code === "P2021" || code === "P2022") return true;
  const message = e instanceof Error ? e.message : String(e ?? "");
  return /does not exist|relation .* does not exist|P2021|P2022/i.test(message);
}

/** The file to run in Supabase, for the message shown on screen. */
export const SETUP_SQL_PATH = "prisma/sql/2026-08-ordering-tables.sql";
