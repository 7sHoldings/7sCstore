import { ReactNode } from "react";
import { fmtPct } from "@/lib/format";

export function Icon({
  name,
  className = "",
  filled = false,
}: {
  name: string;
  className?: string;
  filled?: boolean;
}) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
      aria-hidden
    >
      {name}
    </span>
  );
}

export function Card({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`bg-surface-container-lowest border border-outline-variant/60 rounded-lg shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

/** A KPI metric card (design: label-caps header + data-display metric + trend). */
export function KpiCard({
  label,
  value,
  trend,
  hint,
  icon,
  accent = "primary",
}: {
  label: string;
  value: string;
  trend?: number | null;
  hint?: string;
  icon?: string;
  accent?: "primary" | "success" | "error" | "warning";
}) {
  const accentText =
    accent === "success"
      ? "text-secondary"
      : accent === "error"
      ? "text-error"
      : accent === "warning"
      ? "text-tertiary"
      : "text-primary";
  return (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-label-caps uppercase text-on-surface-variant tracking-wider">
          {label}
        </span>
        {icon && <Icon name={icon} className={`text-[20px] ${accentText} opacity-70`} />}
      </div>
      <div className={`tabular text-2xl font-bold ${accentText}`}>{value}</div>
      <div className="flex items-center gap-2 text-body-sm text-on-surface-variant">
        {trend !== undefined && <TrendChip value={trend} />}
        {hint && <span className="truncate">{hint}</span>}
      </div>
    </Card>
  );
}

export function TrendChip({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-label-caps bg-surface-container text-on-surface-variant">
        new
      </span>
    );
  }
  const up = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-label-caps ${
        up ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container"
      }`}
    >
      <Icon name={up ? "trending_up" : "trending_down"} className="text-[14px]" />
      {fmtPct(value)}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "error" | "warning" | "info";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-surface-container text-on-surface-variant",
    success: "bg-secondary-container text-on-secondary-container",
    error: "bg-error-container text-on-error-container",
    warning: "bg-tertiary-container text-on-tertiary-container",
    info: "bg-surface-container-high text-primary",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label-caps uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      <div>
        <h1 className="text-headline-lg font-bold text-primary tracking-tight">{title}</h1>
        {subtitle && <p className="text-on-surface-variant mt-0.5 text-body-md">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon = "inbox",
  title,
  hint,
}: {
  icon?: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center mb-3">
        <Icon name={icon} className="text-[28px] text-on-surface-variant" />
      </div>
      <p className="font-semibold text-on-surface">{title}</p>
      {hint && <p className="text-body-sm text-on-surface-variant mt-1 max-w-sm">{hint}</p>}
    </div>
  );
}
