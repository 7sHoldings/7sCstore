"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/location";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { parseCSV, SALES_TEMPLATE_HEADERS } from "@/lib/csv";
import { money, perGallon } from "@/lib/calc";

const CATEGORIES = ["FUEL", "STORE", "LOTTERY", "TOBACCO", "FOOD_DRINK", "OTHER"];
const PAYMENTS = ["CASH", "CARD", "OTHER"];
const GRADES = ["REGULAR", "MID", "PREMIUM", "DIESEL"];

export interface ImportResult {
  ok?: boolean;
  imported?: number;
  errors?: { row: number; message: string }[];
  error?: string;
}

interface ParsedRow {
  date: Date;
  category: string;
  paymentType: string;
  amount: number;
  taxCollected: number;
  grade?: string;
  gallons?: number;
  pricePerGallon?: number;
  note?: string;
}

/**
 * Validate-then-commit CSV import for sales (FR-40, NFR-8). The whole file is
 * validated first; if any row is invalid, nothing is saved and every error is
 * reported back so the user can fix the file.
 */
export async function importSales(
  _prev: ImportResult | undefined,
  formData: FormData
): Promise<ImportResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!can(session.role, "enterSales")) return { error: "You don't have permission to import sales." };
  const locationId = await getActiveLocationId();
  if (!locationId) return { error: "No location assigned." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a CSV file to import." };

  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return { error: "The file has no data rows." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  const missing = SALES_TEMPLATE_HEADERS.filter((h) => idx(h) === -1 && h !== "note");
  if (missing.length) {
    return { error: `Missing required columns: ${missing.join(", ")}. Download the template for the correct format.` };
  }

  const errors: { row: number; message: string }[] = [];
  const parsed: ParsedRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (name: string) => (idx(name) >= 0 ? (cells[idx(name)] ?? "").trim() : "");
    const lineNo = r + 1;

    const dateStr = get("date");
    const date = new Date(dateStr);
    if (!dateStr || isNaN(date.getTime())) {
      errors.push({ row: lineNo, message: `Invalid date "${dateStr}".` });
      continue;
    }
    const category = get("category").toUpperCase();
    if (!CATEGORIES.includes(category)) {
      errors.push({ row: lineNo, message: `Invalid category "${category}".` });
      continue;
    }
    const paymentType = (get("paymentType") || "CASH").toUpperCase();
    if (!PAYMENTS.includes(paymentType)) {
      errors.push({ row: lineNo, message: `Invalid payment type "${paymentType}".` });
      continue;
    }

    if (category === "FUEL") {
      const grade = get("grade").toUpperCase();
      const gallons = Number(get("gallons"));
      const price = Number(get("pricePerGallon"));
      if (!GRADES.includes(grade)) {
        errors.push({ row: lineNo, message: `Invalid fuel grade "${grade}".` });
        continue;
      }
      if (!(gallons > 0) || !(price > 0)) {
        errors.push({ row: lineNo, message: `Fuel rows need positive gallons and pricePerGallon.` });
        continue;
      }
      parsed.push({ date, category, paymentType, amount: money(gallons * price), taxCollected: 0, grade, gallons, pricePerGallon: price, note: get("note") });
    } else {
      const amount = Number(get("amount"));
      const tax = Number(get("taxCollected") || "0");
      if (!(amount >= 0) || isNaN(amount)) {
        errors.push({ row: lineNo, message: `Invalid amount "${get("amount")}".` });
        continue;
      }
      parsed.push({ date, category, paymentType, amount, taxCollected: isNaN(tax) ? 0 : tax, note: get("note") });
    }
  }

  if (errors.length) {
    return { ok: false, errors, imported: 0 };
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const p of parsed) {
        if (p.category === "FUEL") {
          const lastDelivery = await tx.fuelDelivery.findFirst({
            where: { locationId: locationId, grade: p.grade as never },
            orderBy: { date: "desc" },
          });
          await tx.sale.create({
            data: {
              date: p.date,
              locationId: locationId,
              category: "FUEL",
              paymentType: p.paymentType as never,
              amount: p.amount,
              taxCollected: 0,
              note: p.note,
              source: "CSV_IMPORT",
              enteredById: session.userId,
              fuelSale: {
                create: {
                  date: p.date,
                  locationId: locationId,
                  grade: p.grade as never,
                  gallons: p.gallons!,
                  pricePerGallon: perGallon(p.pricePerGallon!),
                  total: p.amount,
                  taxPerGallon: 0.184,
                  costPerGallon: perGallon(lastDelivery?.costPerGallon ?? 0),
                },
              },
            },
          });
        } else {
          await tx.sale.create({
            data: {
              date: p.date,
              locationId: locationId,
              category: p.category as never,
              paymentType: p.paymentType as never,
              amount: money(p.amount),
              taxCollected: money(p.taxCollected),
              note: p.note,
              source: "CSV_IMPORT",
              enteredById: session.userId,
            },
          });
        }
      }
    });
  } catch (e) {
    console.error(e);
    return { error: "Import failed while saving. No rows were imported." };
  }

  await logAudit({ userId: session.userId, action: "IMPORT", entity: "Sale", after: { count: parsed.length } });
  revalidatePath("/sales");
  revalidatePath("/dashboard");
  return { ok: true, imported: parsed.length };
}
