import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // If no users exist yet (fresh / wiped database), send to first-run setup.
  const count = await prisma.user.count();
  if (count === 0) redirect("/setup");
  return <LoginForm />;
}
