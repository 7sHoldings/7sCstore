import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { rangeFor, customRange, type PeriodKey, type Range } from "@/lib/period";
import { getAccountLedger, getHouseChargeEntries, getHousePayments } from "@/lib/credit";
import { getReceipts } from "@/lib/receipts";
import { signedUrl, signedUrls } from "@/lib/storage";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LINK_TTL = 60 * 60 * 24 * 7; // receipt links stay valid for 7 days

interface ExportRow {
  date: string;
  account: string;
  kind: "charge" | "payment";
  note: string;
  charge: number | null;
  payment: number | null;
  balance?: number | null;
  receipts: string[];
}

/**
 * Export House Accounts activity as CSV or Excel. Honors the page's filters
 * (period / from+to / account) so the file contains exactly what's on screen,
 * with receipt links and charge/payment totals.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(session.role, "exportReports")) {
    return new NextResponse("Forbidden — your role can't export reports.", { status: 403 });
  }
  const loc = await getActiveLocationId();
  if (!loc) return new NextResponse("No location assigned.", { status: 400 });

  const sp = req.nextUrl.searchParams;
  const format = (sp.get("format") ?? "csv").toLowerCase();
  const account = sp.get("account") || undefined;
  const from = sp.get("from");
  const to = sp.get("to");
  const period = sp.get("period") as PeriodKey | null;

  let range: Range | null = null;
  if (from && to) range = customRange(from, to);
  else if (period) range = rangeFor(period);
  const inRange = (dateISO: string) => {
    if (!range) return true;
    const d = new Date(dateISO + "T00:00:00");
    return d >= range.start && d < range.end;
  };
  const rangeLabel = range ? range.label : "All time";

  // Signed receipt links: payment photo, or the day's Credit Entry receipts for charges.
  const chargeReceiptCache = new Map<string, string[]>();
  const chargeReceiptsFor = async (date: string): Promise<string[]> => {
    if (!chargeReceiptCache.has(date)) {
      const paths = await getReceipts(loc, "credit", date);
      chargeReceiptCache.set(date, paths.length ? await signedUrls(paths, true) : []);
    }
    return chargeReceiptCache.get(date)!;
  };

  const rows: ExportRow[] = [];
  if (account) {
    // Single account: full ledger (running balance stays accurate), windowed.
    const ledger = await getAccountLedger(loc, account);
    let running = 0;
    for (const e of ledger) {
      running += e.kind === "charge" ? e.amount : -e.amount;
      if (!inRange(e.date)) continue;
      rows.push({
        date: e.date,
        account,
        kind: e.kind,
        note: e.note ?? "",
        charge: e.kind === "charge" ? e.amount : null,
        payment: e.kind === "payment" ? e.amount : null,
        balance: running,
        receipts: e.kind === "payment"
          ? (e.photo ? [(await signedUrl(e.photo, LINK_TTL, true)) ?? ""].filter(Boolean) : [])
          : await chargeReceiptsFor(e.date),
      });
    }
    rows.reverse(); // newest first, matching the page
  } else {
    const [charges, payments] = await Promise.all([
      getHouseChargeEntries(loc, range?.start, range?.end),
      getHousePayments(loc),
    ]);
    for (const c of charges) {
      rows.push({
        date: c.date, account: c.account, kind: "charge", note: "",
        charge: c.amount, payment: null, receipts: await chargeReceiptsFor(c.date),
      });
    }
    for (const p of payments) {
      if (!inRange(p.date)) continue;
      rows.push({
        date: p.date, account: p.account, kind: "payment", note: p.note ?? "",
        charge: null, payment: p.amount,
        receipts: p.photo ? [(await signedUrl(p.photo, LINK_TTL, true)) ?? ""].filter(Boolean) : [],
      });
    }
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.kind === "charge" ? -1 : 1));
  }

  const totalCharged = rows.reduce((s, r) => s + (r.charge ?? 0), 0);
  const totalPaid = rows.reduce((s, r) => s + (r.payment ?? 0), 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  await logAudit({
    userId: session.userId, action: "EXPORT", entity: "HouseAccounts",
    entityId: account ?? "all", after: { format, range: rangeLabel, rows: rows.length },
  });

  const withBalance = Boolean(account);
  const safe = (s: string) => s.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "all";
  const filenameBase = `house-accounts_${safe(account ?? "all-accounts")}_${safe(rangeLabel)}`;

  if (format === "xlsx" || format === "excel") {
    const wb = new ExcelJS.Workbook();
    wb.creator = "7sCstores";
    wb.created = new Date();
    const ws = wb.addWorksheet("House Accounts");
    const navy = "FF0A2540";

    ws.addRow([`House Accounts — ${account ?? "All accounts"}`]).font = { size: 14, bold: true, color: { argb: navy } };
    ws.addRow([`Activity: ${rangeLabel}`]).font = { color: { argb: "FF43474D" } };
    ws.addRow([]);

    const headers = ["Date", "Account", "Type", "Note", "Charge", "Payment", ...(withBalance ? ["Balance"] : []), "Receipts"];
    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
    });
    ws.columns = [
      { width: 12 }, { width: 24 }, { width: 10 }, { width: 24 },
      { width: 12 }, { width: 12 }, ...(withBalance ? [{ width: 12 }] : []), { width: 60 },
    ];

    for (const r of rows) {
      const row = ws.addRow([
        r.date, r.account, r.kind === "charge" ? "Charge" : "Payment", r.note,
        r.charge ?? "", r.payment ?? "", ...(withBalance ? [r.balance ?? ""] : []), "",
      ]);
      const receiptCell = row.getCell(headers.length);
      if (r.receipts.length === 1) {
        receiptCell.value = { text: "Receipt", hyperlink: r.receipts[0] };
        receiptCell.font = { color: { argb: "FF1155CC" }, underline: true };
      } else if (r.receipts.length > 1) {
        receiptCell.value = r.receipts.join(" | ");
      }
    }

    ws.addRow([]);
    const totals = ws.addRow(["Totals", "", "", "", round2(totalCharged), round2(totalPaid), ...(withBalance ? [""] : []), ""]);
    totals.font = { bold: true };

    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
      },
    });
  }

  // CSV
  const q = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = ["date", "account", "type", "note", "charge", "payment", ...(withBalance ? ["balance"] : []), "receipts"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      q(r.date), q(r.account), q(r.kind), q(r.note),
      q(r.charge ?? ""), q(r.payment ?? ""),
      ...(withBalance ? [q(r.balance ?? "")] : []),
      q(r.receipts.join(" | ")),
    ].join(","));
  }
  lines.push("");
  lines.push([q("totals"), "", "", "", q(round2(totalCharged)), q(round2(totalPaid)), ...(withBalance ? [""] : []), ""].join(","));

  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
    },
  });
}
