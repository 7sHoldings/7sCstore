import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getActiveLocationId } from "@/lib/location";
import { getLatestReading, TANK_GRADES } from "@/lib/tank";
import { todayISO } from "@/lib/day";
import { fmtNumber, gradeLabel } from "@/lib/format";
import { Card, PageHeader, EmptyState, Banner } from "@/components/ui";
import TankReadingForm from "./TankReadingForm";

export const dynamic = "force-dynamic";

export default async function TankReadingPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "enterSales")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="You don't have permission to enter tank readings." /></Card>;
  }
  const loc = await getActiveLocationId();
  const sp = await searchParams;
  const latest = await Promise.all(TANK_GRADES.map(async (g) => ({ grade: g, reading: loc ? await getLatestReading(loc, g) : null })));

  return (
    <div>
      <PageHeader title="Tank Reading" subtitle="Stick the tanks and enter the inches — gallons are calculated for you." />
      {sp.saved && <Banner>Tank readings saved.</Banner>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <TankReadingForm defaultDate={todayISO()} />
        </Card>

        <Card className="p-5 h-fit">
          <h3 className="font-semibold text-on-surface mb-3">Latest reading</h3>
          <div className="space-y-2 text-body-sm">
            {latest.map(({ grade, reading }) => (
              <div key={grade} className="flex items-center justify-between rounded-md bg-surface-container-low px-3 py-2">
                <span className="font-medium">{gradeLabel(grade)}</span>
                {reading ? (
                  <span className="text-on-surface-variant">{reading.inches}″ · <span className="tabular font-semibold text-on-surface">{fmtNumber(reading.gallons)} gal</span> · {reading.date}</span>
                ) : <span className="text-on-surface-variant">No reading yet</span>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
