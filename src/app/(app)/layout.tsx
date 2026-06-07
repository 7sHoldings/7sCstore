import { redirect } from "next/navigation";
import { getSession, destroySession } from "@/lib/auth";
import { listLocations, getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { switchLocation } from "./locations/actions";
import AppShell from "@/components/AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

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
