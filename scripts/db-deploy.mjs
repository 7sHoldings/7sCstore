// Applies any Prisma schema changes to the database during a Vercel **production**
// build, so you never have to run migrations locally. Uses `prisma db push`,
// which reads `directUrl` (DIRECT_URL) from schema.prisma for safe DDL.
//
// Safety rules:
//   - Runs only on production deploys (VERCEL_ENV=production), or when
//     FORCE_DB_PUSH=1 is set, so preview builds don't touch the prod DB.
//   - Never fails the build: if the push errors (e.g. a destructive change that
//     needs review, or DIRECT_URL missing), it logs a clear warning and lets the
//     deploy continue. Apply such changes via the SQL we hand you in Supabase.
import { execSync } from "node:child_process";

const isProd = process.env.VERCEL_ENV === "production" || process.env.FORCE_DB_PUSH === "1";

if (!isProd) {
  console.log("[db-deploy] Not a production deploy — skipping schema sync.");
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.warn("[db-deploy] DATABASE_URL not set — skipping schema sync.");
  process.exit(0);
}

try {
  console.log("[db-deploy] Syncing database schema with `prisma db push`…");
  execSync("npx prisma db push --skip-generate", { stdio: "inherit" });
  console.log("[db-deploy] Database schema is in sync.");
} catch {
  console.error(
    "[db-deploy] WARNING: `prisma db push` failed — schema left UNCHANGED.\n" +
    "            If a schema change was expected, apply it in the Supabase SQL editor.\n" +
    "            (Not failing the build so your deploy still goes out.)"
  );
  process.exit(0);
}
