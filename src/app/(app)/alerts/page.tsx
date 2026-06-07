import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { evaluateAlerts } from "@/lib/alerts";
import { getSettings } from "@/lib/settings";
import { providerStatus } from "@/lib/notify";
import { Card, PageHeader, Badge, EmptyState, Icon } from "@/components/ui";
import { updateThresholds } from "./actions";
import DismissButton from "./DismissButton";
import NotificationSettings from "./NotificationSettings";

export const dynamic = "force-dynamic";

const SEVERITY: Record<string, { tone: "info" | "warning" | "error"; icon: string }> = {
  info: { tone: "info", icon: "info" },
  warning: { tone: "warning", icon: "warning" },
  error: { tone: "error", icon: "error" },
};

export default async function AlertsPage() {
  const session = (await getSession())!;
  const loc = (await getActiveLocationId()) ?? undefined;

  const [alerts, settings, notify] = await Promise.all([
    evaluateAlerts(loc),
    prisma.alertSetting.findMany(),
    getSettings(["notifyEmail", "notifyPhone", "emailEnabled", "smsEnabled"]),
  ]);
  const setting = (key: string) => settings.find((s) => s.key === key)?.value ?? 0;
  const canConfig = can(session.role, "viewAll");
  const providers = providerStatus();

  return (
    <div>
      <PageHeader
        title="Alerts & Notifications"
        subtitle="Operational warnings and reminders for your station"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Alerts list */}
        <div className="lg:col-span-2">
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface flex items-center justify-between">
              Active Alerts
              <Badge tone={alerts.length ? "warning" : "success"}>{alerts.length} active</Badge>
            </div>
            {alerts.length === 0 ? (
              <EmptyState icon="notifications_off" title="All clear" hint="No active alerts right now." />
            ) : (
              <ul className="divide-y divide-outline-variant/40">
                {alerts.map((a) => {
                  const sev = SEVERITY[a.severity] ?? SEVERITY.info;
                  return (
                    <li key={a.id} className="px-4 py-3 flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                        a.severity === "error" ? "bg-error-container" : a.severity === "warning" ? "bg-tertiary-container" : "bg-surface-container-high"
                      }`}>
                        <Icon name={sev.icon} className={`text-[20px] ${a.severity === "error" ? "text-error" : a.severity === "warning" ? "text-tertiary" : "text-primary"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge tone={sev.tone}>{a.type.replace(/_/g, " ")}</Badge>
                          {a.live && <span className="text-label-caps uppercase text-on-surface-variant">live</span>}
                        </div>
                        <p className="text-body-md text-on-surface mt-1">{a.message}</p>
                      </div>
                      {!a.live && <DismissButton id={a.id} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* Threshold settings */}
        <div>
          <Card className="p-5">
            <h3 className="font-semibold text-on-surface mb-1">Alert Thresholds</h3>
            <p className="text-body-sm text-on-surface-variant mb-4">Set the values that trigger alerts (FR-39).</p>
            {canConfig ? (
              <form action={updateThresholds} className="space-y-3">
                <Threshold name="lowProfitDay" label="Low profit target ($)" value={setting("lowProfitDay")} />
                <Threshold name="highExpense" label="High expense ($)" value={setting("highExpense")} />
                <Threshold name="lowInventory" label="Low inventory (units)" value={setting("lowInventory")} />
                <Threshold name="unusualSalesDropPct" label="Unusual sales drop (%)" value={setting("unusualSalesDropPct")} />
                <button type="submit" className="ft-btn-primary w-full justify-center">
                  <Icon name="save" className="text-[18px]" /> Save thresholds
                </button>
              </form>
            ) : (
              <p className="text-body-sm text-on-surface-variant">Your role can't change thresholds.</p>
            )}

            {canConfig && (
              <NotificationSettings
                email={notify.notifyEmail ?? ""}
                phone={notify.notifyPhone ?? ""}
                emailEnabled={notify.emailEnabled === "true"}
                smsEnabled={notify.smsEnabled === "true"}
                emailProvider={providers.emailProvider}
                smsProvider={providers.smsProvider}
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Threshold({ name, label, value }: { name: string; label: string; value: number }) {
  return (
    <div>
      <label className="ft-label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type="number" step="0.01" min="0" defaultValue={value} className="ft-input" />
    </div>
  );
}
