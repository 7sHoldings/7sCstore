import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import SetupForm from "./SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  // Setup is only available before any user exists.
  const count = await prisma.user.count();
  if (count > 0) redirect("/login");
  return <SetupForm />;
}
