import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { rangeFor, customRange, type PeriodKey } from "@/lib/period";
import { buildReport, REPORT_META, type ReportType } from "@/lib/reportBuilder";
import { Card, PageHeader, Icon, EmptyState } from "@/components/ui";
import PeriodSelect from "@/components/PeriodSelect";

export const dynamic = "force-dynamic";

const ORDER: ReportType[] = [
  "daily", "weekly", "monthly_pl", "yearly",
  "expense", "purchase", "vendor", "inventory", "sales_by_category",
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; type?: string; from?: string; to?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "viewProfit")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Your role can't view reports." /></Card>;
  }
  const canExport = can(session.role, "exportReports");
  const sp = await searchParams;
  const period = (sp.period as PeriodKey) || "mtd";
  const type = (sp.type as ReportType) && REPORT_META[sp.type as ReportType] ? (sp.type as ReportType) : "monthly_pl";
  const range = sp.from && sp.to ? customRange(sp.from, sp.to) : rangeFor(period);

  const doc = await buildReport(type, range, session.locationId ?? undefined);

  const exportQs = new URLSearchParams();
  if (sp.from && sp.to) {
    exportQs.set("from", sp.from);
    exportQs.set("to", sp.to);
  } else {
    exportQs.set("period", period);
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Generate, preview, and export business reports"
        actions={<PeriodSelect value={period} />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Report picker */}
        <div className="lg:col-span-1 space-y-2">
          {ORDER.map((t) => {
            const meta = REPORT_META[t];
            const active = t === type;
            const qs = new URLSearchParams({ type: t, period });
            return (
              <a
                key={t}
                href={`/reports?${qs.toString()}`}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  active
                    ? "bg-primary text-on-primary border-primary"
                    : "bg-surface-container-lowest border-outline-variant/60 hover:bg-surface-container-low"
                }`}
              >
                <div className={`w-9 h-9 rounded-md flex items-center justify-center ${active ? "bg-on-primary/15" : "bg-surface-container"}`}>
                  <Icon name={meta.icon} className={`text-[20px] ${active ? "text-on-primary" : "text-primary"}`} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-body-md truncate">{meta.title}</div>
                  <div className={`text-body-sm truncate ${active ? "text-on-primary-container" : "text-on-surface-variant"}`}>
                    {meta.desc}
                  </div>
                </div>
              </a>
            );
          })}
        </div>

        {/* Preview */}
        <div className="lg:col-span-2">
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-outline-variant/60 flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="font-semibold text-on-surface text-headline-sm">{doc.title}</h3>
                <p className="text-body-sm text-on-surface-variant">{doc.periodLabel}</p>
              </div>
              {canExport && (
                <div className="flex gap-2">
                  <a
                    href={`/api/export?type=${type}&format=pdf&${exportQs.toString()}`}
                    className="ft-btn-secondary"
                  >
                    <Icon name="picture_as_pdf" className="text-[18px]" /> PDF
                  </a>
                  <a
                    href={`/api/export?type=${type}&format=excel&${exportQs.toString()}`}
                    className="ft-btn-primary"
                  >
                    <Icon name="table_view" className="text-[18px]" /> Excel
                  </a>
                </div>
              )}
            </div>

            <div className="p-5">
              {/* Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                {doc.summary.map((s) => (
                  <div key={s.label} className="bg-surface-container-low rounded-md p-3">
                    <div className="text-label-caps uppercase text-on-surface-variant">{s.label}</div>
                    <div className="tabular text-base font-bold text-on-surface mt-0.5">{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Sections */}
              {doc.sections.map((section) => (
                <div key={section.heading} className="mb-6 last:mb-0">
                  <h4 className="font-semibold text-on-surface mb-2">{section.heading}</h4>
                  <div className="overflow-x-auto custom-scrollbar border border-outline-variant/60 rounded-lg">
                    <table className="w-full text-left text-body-sm">
                      <thead>
                        <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                          {section.columns.map((c, i) => (
                            <th key={c} className={`px-4 py-2.5 ${section.align?.[i] === "right" ? "text-right" : ""}`}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/40">
                        {section.rows.length === 0 ? (
                          <tr><td colSpan={section.columns.length} className="px-4 py-4 text-center text-on-surface-variant">No data for this period.</td></tr>
                        ) : (
                          section.rows.map((r, ri) => (
                            <tr key={ri}>
                              {r.map((cell, ci) => (
                                <td key={ci} className={`px-4 py-2.5 ${section.align?.[ci] === "right" ? "text-right tabular" : ""}`}>{cell}</td>
                              ))}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
