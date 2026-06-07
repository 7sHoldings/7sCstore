import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import ImportForm from "./ImportForm";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = (await getSession())!;
  if (!can(session.role, "enterSales")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Your role can't import data." /></Card>;
  }

  return (
    <div>
      <PageHeader
        title="Import Data"
        subtitle="Bulk-import sales from a CSV / Excel export — the manual side of the integration layer"
      />
      <div className="max-w-2xl">
        <ImportForm />
      </div>
    </div>
  );
}
