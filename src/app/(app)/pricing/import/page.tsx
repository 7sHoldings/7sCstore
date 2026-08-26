import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { Card, PageHeader, EmptyState, Icon } from "@/components/ui";
import ImportPriceBook from "./ImportPriceBook";

export const dynamic = "force-dynamic";

export default async function PriceBookImportPage() {
  const session = (await getSession())!;
  if (!can(session.role, "enterPurchases")) {
    return (
      <Card className="p-8">
        <EmptyState icon="lock" title="No access" hint="Your role can't import a price book." />
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        title="Import Price Book"
        subtitle="Upload the Modisoft Inventory export to load products, UPCs, departments and prices"
        actions={
          <Link href="/pricing" className="ft-btn-secondary">
            <Icon name="arrow_back" className="text-[18px]" /> Back to Pricing
          </Link>
        }
      />
      <ImportPriceBook />
    </div>
  );
}
