import { redirect } from "next/navigation";
import { getSession, destroySession } from "@/lib/auth";
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

  return (
    <AppShell
      role={session.role}
      name={session.name}
      email={session.email}
      logout={logout}
    >
      {children}
    </AppShell>
  );
}
