// One-time backfill: mirror historical Credit Entry "Payout in Cash" lines into
// the Expense table, same mapping the app now applies on every save —
// "Product Buying · X" → Inventory Purchase from X, everything else → Store
// Operating Expense, method Cash, marker note linking it to the Credit Entry.
//
// Idempotent: guarded by a Setting flag, and days that already have mirrored
// expenses are skipped. Never fails the caller — errors are logged and ignored.
import { PrismaClient } from "@prisma/client";

const MARKER = "Payout in Cash (Credit Entry)";
const FLAG = "payoutexpense:backfilled";

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

export async function backfillPayoutExpenses() {
  const prisma = new PrismaClient();
  try {
    const done = await prisma.setting.findUnique({ where: { key: FLAG } });
    if (done) {
      console.log("[backfill-payouts] Already backfilled — skipping.");
      return;
    }

    const rows = await prisma.setting.findMany({ where: { key: { startsWith: "creditmanual:" } } });
    const mirrored = await prisma.expense.findMany({ where: { note: MARKER }, select: { locationId: true, date: true } });
    const have = new Set(mirrored.map((e) => `${e.locationId}:${e.date.toISOString().slice(0, 10)}`));

    let created = 0;
    for (const r of rows) {
      const [, locationId, dateISO] = r.key.split(":");
      if (!locationId || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO ?? "")) continue;
      if (have.has(`${locationId}:${dateISO}`)) continue;

      let payouts = [];
      try {
        const o = JSON.parse(r.value);
        if (Array.isArray(o.payouts)) {
          payouts = o.payouts
            .map((p) => ({ account: String(p.account ?? "").trim(), amount: money(p.amount) }))
            .filter((p) => p.account && p.amount > 0);
        } else if (money(o.payoutCash) > 0) {
          payouts = [{ account: "Payout", amount: money(o.payoutCash) }];
        }
      } catch {
        continue;
      }
      if (!payouts.length) continue;

      for (const p of payouts) {
        const [parent, sub] = p.account.split(" · ").map((s) => s.trim());
        const isProductBuying = (parent ?? "").toLowerCase().includes("product buying");
        await prisma.expense.create({
          data: {
            date: new Date(dateISO),
            locationId,
            category: isProductBuying ? "INVENTORY_PURCHASE" : "STORE_OPERATING_EXPENSES",
            amount: p.amount,
            payee: sub || parent || p.account,
            paymentMethod: "CASH",
            note: MARKER,
            source: "MANUAL",
          },
        });
        created++;
      }
    }

    await prisma.setting.upsert({ where: { key: FLAG }, update: { value: "1" }, create: { key: FLAG, value: "1" } });
    console.log(`[backfill-payouts] Done — mirrored ${created} payout line(s) into Expenses.`);
  } catch (e) {
    console.error("[backfill-payouts] WARNING: backfill failed (deploy continues):", e?.message ?? e);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}
