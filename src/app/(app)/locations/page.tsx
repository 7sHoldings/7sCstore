import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveLocationId } from "@/lib/location";
import { Card, PageHeader, Badge, EmptyState, Icon } from "@/components/ui";
import LocationForm from "./LocationForm";
import LocationManager from "./LocationManager";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const session = (await getSession())!;
  if (!can(session.role, "manageUsers")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Only owners can manage locations." /></Card>;
  }
  const activeId = await getActiveLocationId();

  const locations = await prisma.location.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { sales: true, expenses: true, users: true } } },
  });

  return (
    <div>
      <PageHeader
        title="Locations"
        subtitle="Manage your stations. Switch the active location from the top bar."
        actions={<LocationForm />}
      />

      {locations.length === 0 ? (
        <Card className="p-8"><EmptyState icon="location_on" title="No locations yet" hint="Add your first station." /></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {locations.map((l) => (
            <Card key={l.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-md bg-surface-container flex items-center justify-center">
                    <Icon name="local_gas_station" className="text-[20px] text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold text-on-surface">{l.name}</div>
                    <div className="text-body-sm text-on-surface-variant">{l.address || "No address"}</div>
                  </div>
                </div>
                {l.id === activeId && <Badge tone="success">Active</Badge>}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex gap-4 text-body-sm text-on-surface-variant">
                  <span>{l._count.sales} sales</span>
                  <span>{l._count.expenses} expenses</span>
                  <span>{l._count.users} users</span>
                </div>
                <LocationManager id={l.id} name={l.name} address={l.address} canDelete={locations.length > 1} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
