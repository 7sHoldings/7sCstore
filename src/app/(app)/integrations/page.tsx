import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { activeAdapter } from "@/lib/integrations/sync";
import { fmtDateTime } from "@/lib/format";
import { Card, PageHeader, Badge, EmptyState, Icon } from "@/components/ui";
import SyncButton from "./SyncButton";
import Backfill from "./Backfill";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = (await getSession())!;
  if (!can(session.role, "viewAll")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" /></Card>;
  }
  const loc = await getActiveLocationId();
  const { adapter, live } = activeAdapter();

  const logs = await prisma.syncLog.findMany({
    where: loc ? { locationId: loc } : {},
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  const lastSuccess = logs.find((l) => l.status === "SUCCESS");

  return (
    <div>
      <PageHeader title="Integrations" subtitle="POS sync (Modi) and the import integration layer" />

      <Card className="p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-surface-container flex items-center justify-center">
              <Icon name="point_of_sale" className="text-primary text-[26px]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-on-surface">{adapter.label}</h3>
                {live ? <Badge tone="success">Live</Badge> : <Badge tone="warning">Sandbox</Badge>}
              </div>
              <p className="text-body-sm text-on-surface-variant">
                {live
                  ? "Connected to the Modi POS API."
                  : "Using the sandbox adapter. Set MODI_API_URL and MODI_API_KEY to go live."}
              </p>
              <p className="text-body-sm text-on-surface-variant mt-0.5">
                Last successful sync: {lastSuccess ? fmtDateTime(lastSuccess.finishedAt ?? lastSuccess.startedAt) : "never"}
              </p>
            </div>
          </div>
          <SyncButton />
        </div>
      </Card>

      <div className="mb-6">
        <Backfill defaultFrom={`${new Date().getFullYear()}-01-01`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <InfoCard icon="dataset" title="Integration layer" body="All sources (manual, CSV, POS) write the same Sale records with a source tag, so reports never change as feeds are added." />
        <InfoCard icon="schedule" title="Scheduled sync" body="Trigger a sync here anytime. A scheduled job can call the same runSync() to automate it (FR-43)." />
        <InfoCard icon="notifications_active" title="Failure alerts" body="A failed sync is logged and raises an error alert visible on the Alerts page." />
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">Sync Log</div>
        {logs.length === 0 ? (
          <EmptyState icon="sync" title="No syncs yet" hint="Click “Sync now” to pull from the POS." />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Records</th>
                  <th className="px-4 py-3">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 whitespace-nowrap text-on-surface-variant">{fmtDateTime(l.startedAt)}</td>
                    <td className="px-4 py-3">
                      {l.status === "SUCCESS" ? <Badge tone="success">Success</Badge> : l.status === "FAILED" ? <Badge tone="error">Failed</Badge> : <Badge tone="info">Running</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right tabular">{l.recordsImported}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{l.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function InfoCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon name={icon} className="text-primary text-[20px]" />
        <h4 className="font-semibold text-on-surface">{title}</h4>
      </div>
      <p className="text-body-sm text-on-surface-variant">{body}</p>
    </Card>
  );
}
