/**
 * Live alert evaluation (FR-36). Computes operational alerts from current data
 * against owner-configured thresholds (FR-39), combined with any stored alerts.
 */
import { prisma } from "./db";
import { rangeFor } from "./period";
import { getReportData } from "./reports";
import { fmtMoney } from "./format";

export interface ComputedAlert {
  id: string;
  type: string;
  severity: "info" | "warning" | "error";
  message: string;
  live: boolean;
  createdAt?: Date;
}

async function thresholds(): Promise<Record<string, number>> {
  const rows = await prisma.alertSetting.findMany();
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function evaluateAlerts(locationId?: string): Promise<ComputedAlert[]> {
  const t = await thresholds();
  const alerts: ComputedAlert[] = [];

  // Missing daily sales entry — no sales recorded so far today (FR-36).
  const today = rangeFor("today");
  const todaySalesCount = await prisma.sale.count({
    where: { date: { gte: today.start, lt: today.end }, ...(locationId ? { locationId } : {}) },
  });
  if (todaySalesCount === 0) {
    alerts.push({
      id: "live-missing-sales",
      type: "MISSING_SALES",
      severity: "warning",
      message: "No sales have been recorded today yet.",
      live: true,
    });
  }

  // Low profit day (yesterday vs threshold).
  const mtd = rangeFor("mtd");
  const report = await getReportData(mtd, locationId);
  if (t.lowProfitDay && report.pnl.netProfit < t.lowProfitDay) {
    alerts.push({
      id: "live-low-profit",
      type: "LOW_PROFIT",
      severity: "warning",
      message: `Month-to-date net profit (${fmtMoney(report.pnl.netProfit)}) is below your ${fmtMoney(t.lowProfitDay)} target.`,
      live: true,
    });
  }

  // Low inventory products (FR-36).
  const lowProducts = await prisma.product.findMany({
    where: { lowThreshold: { not: null }, ...(locationId ? { locationId } : {}) },
  });
  for (const p of lowProducts) {
    if (p.lowThreshold != null && p.qtyOnHand <= p.lowThreshold) {
      alerts.push({
        id: `live-low-inv-${p.id}`,
        type: "LOW_INVENTORY",
        severity: "warning",
        message: `${p.name} is low on stock (${p.qtyOnHand} on hand, threshold ${p.lowThreshold}).`,
        live: true,
      });
    }
  }

  // Vendor payments due (FR-36).
  const owing = await prisma.vendor.findMany({ where: { balanceOwed: { gt: 0 } } });
  for (const v of owing) {
    alerts.push({
      id: `live-vendor-${v.id}`,
      type: "VENDOR_PAYMENT_DUE",
      severity: "info",
      message: `${v.name} has an outstanding balance of ${fmtMoney(v.balanceOwed)} (${v.terms ?? "no terms"}).`,
      live: true,
    });
  }

  // Stored alerts.
  const stored = await prisma.alert.findMany({
    where: { read: false, ...(locationId ? { locationId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  for (const s of stored) {
    alerts.push({
      id: s.id,
      type: s.type,
      severity: (s.severity as ComputedAlert["severity"]) ?? "info",
      message: s.message,
      live: false,
      createdAt: s.createdAt,
    });
  }

  return alerts;
}
