import { redirect } from "next/navigation";
import { getSession, destroySession } from "@/lib/auth";
import { listLocations, getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { switchLocation } from "./locations/actions";
import AppShell from "@/components/AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Verify the account still exists / is active (e.g. after a data wipe a stale
  // cookie shouldn't keep someone "logged in" as a deleted user).
  const dbUser = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!dbUser || !dbUser.active) {
    await destroySession();
    redirect("/login");
  }

  async function logout() {
    "use server";
    await destroySession();
    redirect("/login");
  }

  const canSwitch = can(session.role, "viewAll");
  const locations = canSwitch ? await listLocations() : [];
  const activeLocationId = await getActiveLocationId();

  return (
    <AppShell
      role={session.role}
      name={session.name}
      email={session.email}
      logout={logout}
      locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      activeLocationId={activeLocationId}
      switchLocation={switchLocation}
    >
      {children}
    </AppShell>
  );
}
