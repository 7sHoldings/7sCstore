"use client";

import { useState } from "react";
import { Card, Icon, Badge } from "@/components/ui";
import { checkConnection, type ConnectionCheck as Facts } from "./actions";

/**
 * States what this deployment is actually holding, and what Modisoft says to it.
 *
 * "I changed the cookie and it still fails" has two causes that look identical
 * from outside: the value was saved but the deployment was never rebuilt, so the
 * server still runs the old one; or the new cookie is genuinely rejected. This
 * separates them, because guessing between them has cost days.
 */
export default function ConnectionCheck() {
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<Facts | null>(null);

  async function run() {
    setBusy(true);
    try {
      setD(await checkConnection());
    } finally {
      setBusy(false);
    }
  }

  const issued = d?.clearanceIssuedAt ? new Date(d.clearanceIssuedAt) : null;
  const ageMin = issued ? Math.round((Date.now() - issued.getTime()) / 60000) : null;
  // Cloudflare issues cf_clearance when the browser solves the challenge, so a
  // token older than a couple of hours cannot be one pasted in minutes ago.
  const looksStale = ageMin != null && ageMin > 120;

  return (
    <Card className="p-5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="troubleshoot" className="text-primary text-[20px]" />
          <h3 className="font-semibold text-on-surface">Connection check</h3>
        </div>
        <button onClick={run} disabled={busy} className="ft-btn-secondary py-1.5">
          {busy ? (
            <><Icon name="progress_activity" className="text-[18px] animate-spin" /> Checking…</>
          ) : (
            <><Icon name="play_arrow" className="text-[18px] " /> Run check</>
          )}
        </button>
      </div>
      <p className="text-body-sm text-on-surface-variant mt-1">
        What this deployment is holding and what Modisoft answers. Cookie values never leave the
        server — only names and ages.
      </p>

      {d?.error && <p className="mt-3 text-body-sm text-error">{d.error}</p>}

      {d && !d.error && (
        <div className="mt-4 space-y-3">
          {/* The verdict, first */}
          {d.probeOk ? (
            <p className="text-body-sm text-secondary flex items-start gap-1.5">
              <Icon name="check_circle" className="text-[18px] mt-0.5 shrink-0" />
              <span>
                <strong>The session works.</strong> Syncing and price pushes should go through.
              </span>
            </p>
          ) : looksStale ? (
            <p className="text-body-sm text-error flex items-start gap-1.5">
              <Icon name="error" className="text-[18px] mt-0.5 shrink-0" />
              <span>
                <strong>This server is still running an old cookie.</strong> The one it holds was
                issued {formatAge(ageMin!)} ago, so a value saved more recently has not reached it.
                Environment variables only take effect on a new build — go to Vercel →
                Deployments → ⋯ → <strong>Redeploy</strong>, then run this check again.
              </span>
            </p>
          ) : (
            <p className="text-body-sm text-error flex items-start gap-1.5">
              <Icon name="error" className="text-[18px] mt-0.5 shrink-0" />
              <span>
                <strong>The cookie reached the server but Modisoft rejected it.</strong> It is not a
                deployment problem — the reason below is Modisoft&apos;s own answer.
              </span>
            </p>
          )}

          <dl className="text-body-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            <Fact label="MODI_COOKIE set">
              {d.cookiePresent ? `yes · ${d.cookieLength} characters` : <span className="text-error">no</span>}
            </Fact>
            <Fact label="Cookie issued">
              {issued ? (
                <span className={looksStale ? "text-error" : ""}>
                  {formatAge(ageMin!)} ago · {issued.toLocaleString()}
                </span>
              ) : (
                <span className="opacity-60">unknown (no cf_clearance)</span>
              )}
            </Fact>
            <Fact label="Session id">
              {d.hasSession ? "present" : <span className="text-error">missing — copy the whole Cookie header</span>}
            </Fact>
            <Fact label="Cloudflare clearance">
              {d.hasClearance ? "present" : <span className="text-error">missing</span>}
            </Fact>
            <Fact label="Reports host">
              <HostFact host={d.reportHost} varName="MODI_BASE" overridden={d.reportOverridden} />
            </Fact>
            <Fact label="Inventory host">
              <HostFact host={d.inventoryHost} varName="MODI_INV_BASE" overridden={d.inventoryOverridden} />
            </Fact>
          </dl>

          <div>
            <div className="text-body-sm text-on-surface-variant mb-1">Cookies the server has</div>
            <div className="flex flex-wrap gap-1">
              {d.cookieNames.length === 0 ? (
                <span className="text-body-sm text-error">none</span>
              ) : (
                d.cookieNames.map((n) => <Badge key={n} tone="neutral">{n}</Badge>)
              )}
            </div>
          </div>

          <div>
            <div className="text-body-sm text-on-surface-variant mb-1">
              Modisoft&apos;s answer to a store-select
            </div>
            <p className={`text-body-sm break-words ${d.probeOk ? "text-secondary" : "text-error"}`}>
              {d.probeMessage}
            </p>
          </div>

          <details className="text-body-sm">
            <summary className="cursor-pointer text-on-surface-variant">User-agent being sent</summary>
            <p className="mt-1 break-words text-on-surface-variant font-mono text-[11px]">{d.userAgent}</p>
            <p className="mt-1 text-on-surface-variant">
              Cloudflare ties the clearance to the browser that solved it, so this has to match the
              browser you copied the cookie from. Override it with MODI_USER_AGENT.
            </p>
          </details>
        </div>
      )}
    </Card>
  );
}

/**
 * A host, and whether an environment variable is pinning it.
 *
 * An override that points at the wrong host fails exactly like an expired
 * cookie, so the host alone is not enough — the screen has to say where it
 * came from.
 */
function HostFact({ host, varName, overridden }: { host: string; varName: string; overridden: boolean }) {
  if (!overridden) return <>{host}</>;
  return (
    <span className="text-error">
      {host}
      <span className="block text-[11px] opacity-90">set by {varName} — delete it to use the default</span>
    </span>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-outline-variant/30 py-1">
      <dt className="text-on-surface-variant shrink-0">{label}</dt>
      <dd className="text-on-surface text-right">{children}</dd>
    </div>
  );
}

function formatAge(minutes: number): string {
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const h = Math.round(minutes / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${Math.round(h / 24)} days`;
}
