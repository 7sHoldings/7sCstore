/**
 * Production bootstrap — creates ONE location and ONE owner user if they don't
 * already exist. Unlike `db:seed` this is idempotent and never deletes data, so
 * it's safe to run against a live database to create your first login.
 *
 * Usage:
 *   ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="strong-pass" npm run db:bootstrap
 *   # optional: ADMIN_NAME, LOCATION_NAME
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL || process.argv[2] || "").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || process.argv[3] || "";
  const name = process.env.ADMIN_NAME || "Owner";
  const locationName = process.env.LOCATION_NAME || "Main Location";

  if (!email || !password) {
    console.error('Usage: ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="secret" npm run db:bootstrap');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  let location = await prisma.location.findFirst();
  if (!location) {
    location = await prisma.location.create({ data: { name: locationName } });
    console.log(`Created location: ${location.name}`);
  } else {
    console.log(`Using existing location: ${location.name}`);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User already exists, leaving unchanged: ${email}`);
  } else {
    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: "OWNER",
        locationId: location.id,
      },
    });
    console.log(`✅ Created owner user: ${email}`);
  }
  console.log("Bootstrap complete. You can now sign in.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
