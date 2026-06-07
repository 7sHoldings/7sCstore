/**
 * Active-location resolution for multi-location support (Phase 3).
 *
 * A user belongs to a home location, but owners/managers can switch the location
 * they're viewing. The choice is stored in the `ft_location` cookie and falls
 * back to the user's assigned location. Every data query and write resolves the
 * location through here so the whole app stays consistent.
 */
import "server-only";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { getSession } from "./auth";
import { can, type Role } from "./rbac";

const COOKIE = "ft_location";

export async function listLocations() {
  return prisma.location.findMany({ orderBy: { name: "asc" } });
}

/** The location the current user is viewing (cookie override → home location). */
export async function getActiveLocationId(): Promise<string | undefined> {
  const session = await getSession();
  if (!session) return undefined;

  // Only multi-location-capable roles may override via cookie.
  if (can(session.role as Role, "viewAll")) {
    const store = await cookies();
    const chosen = store.get(COOKIE)?.value;
    if (chosen) {
      const exists = await prisma.location.findUnique({ where: { id: chosen } });
      if (exists) return chosen;
    }
  }
  return session.locationId ?? undefined;
}

export async function getActiveLocation() {
  const id = await getActiveLocationId();
  if (!id) return null;
  return prisma.location.findUnique({ where: { id } });
}
