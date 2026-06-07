"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { parseCSV } from "@/lib/csv";
import { money } from "@/lib/calc";

export interface BankImportResult {
  ok?: boolean;
  imported?: number;
  matched?: number;
  errors?: { row: number; message: string }[];
  error?: string;
}

/**
 * Import a bank statement (CSV: date, description, amount) and auto-match each
 * debit to a recorded expense with the same amount within a 4-day window
 * (Phase 3 bank reconciliation).
 */
export async function importBank(
  _prev: BankImportResult | undefined,
  formData: FormData
): Promise<BankImportResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "viewAll")) return { error: "You don't have permission." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a CSV file." };

  const rows = parseCSV(await file.text());
  if (rows.length < 2) return { error: "The file has no data rows." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const di = header.indexOf("date");
  const dei = header.indexOf("description");
  const ai = header.indexOf("amount");
  if (di === -1 || ai === -1) return { error: "CSV must have at least 'date' and 'amount' columns (and ideally 'description')." };

  const errors: { row: number; message: string }[] = [];
  const parsed: { date: Date; description: string; amount: number; kind: string }[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const lineNo = r + 1;
    const date = new Date((cells[di] ?? "").trim());
    if (isNaN(date.getTime())) {
      errors.push({ row: lineNo, message: `Invalid date "${cells[di]}".` });
      continue;
    }
    const rawAmt = Number((cells[ai] ?? "").replace(/[$,]/g, "").trim());
    if (isNaN(rawAmt)) {
      errors.push({ row: lineNo, message: `Invalid amount "${cells[ai]}".` });
      continue;
    }
    parsed.push({
      date,
      description: (cells[dei] ?? "").trim() || "—",
      amount: money(Math.abs(rawAmt)),
      kind: rawAmt < 0 ? "DEBIT" : "CREDIT",
    });
  }

  if (errors.length) return { ok: false, errors, imported: 0 };

  let matched = 0;
  try {
    for (const t of parsed) {
      // Try to match a debit against an expense of equal amount within ±4 days.
      let matchedExpenseId: string | null = null;
      if (t.kind === "DEBIT") {
        const from = new Date(t.date); from.setDate(from.getDate() - 4);
        const to = new Date(t.date); to.setDate(to.getDate() + 4);
        const candidate = await prisma.expense.findFirst({
          where: { locationId, amount: t.amount, date: { gte: from, lte: to } },
        });
        if (candidate) { matchedExpenseId = candidate.id; matched++; }
      }
      await prisma.bankTransaction.create({
        data: {
          locationId,
          date: t.date,
          description: t.description,
          amount: t.amount,
          kind: t.kind,
          matched: matchedExpenseId != null,
          matchedExpenseId,
        },
      });
    }
    await logAudit({ userId: session.userId, action: "IMPORT", entity: "BankTransaction", after: { count: parsed.length, matched } });
  } catch (e) {
    console.error(e);
    return { error: "Import failed while saving." };
  }

  revalidatePath("/bank");
  return { ok: true, imported: parsed.length, matched };
}

export async function clearBankTransactions(): Promise<void> {
  const session = await getSession();
  if (!session || !can(session.role, "editDelete")) return;
  const locationId = await getActiveLocationId();
  await prisma.bankTransaction.deleteMany({ where: locationId ? { locationId } : {} });
  revalidatePath("/bank");
}
