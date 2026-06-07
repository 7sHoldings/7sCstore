/**
 * Seed 7sCstores with the Henderson location, the four user roles, fuel grades
 * (A7), vendors, products, and ~60 days of realistic sales / fuel / expense /
 * purchase history so the dashboard and reports are immediately meaningful.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const GRADES = ["REGULAR", "MID", "PREMIUM", "DIESEL"] as const;
const GRADE_BASE_PRICE: Record<string, number> = {
  REGULAR: 3.19,
  MID: 3.49,
  PREMIUM: 3.79,
  DIESEL: 3.99,
};
const GRADE_COST: Record<string, number> = {
  REGULAR: 2.74,
  MID: 2.99,
  PREMIUM: 3.24,
  DIESEL: 3.39,
};
const FUEL_TAX = 0.184; // combined fed+state per gallon (illustrative)

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  console.log("Resetting data…");
  // Order matters for FK integrity.
  await prisma.fuelSale.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.fuelDelivery.deleteMany();
  await prisma.fuelInventory.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.alertSetting.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.product.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.user.deleteMany();
  await prisma.location.deleteMany();

  const location = await prisma.location.create({
    data: { name: "Henderson", address: "Henderson, NV" },
  });

  console.log("Creating users…");
  const pw = await bcrypt.hash("password123", 10);
  await prisma.user.createMany({
    data: [
      { name: "Owner", email: "owner@7scstores.com", passwordHash: pw, role: "OWNER", locationId: location.id },
      { name: "Manager", email: "manager@7scstores.com", passwordHash: pw, role: "MANAGER", locationId: location.id },
      { name: "Accountant", email: "accountant@7scstores.com", passwordHash: pw, role: "ACCOUNTANT", locationId: location.id },
      { name: "Employee", email: "employee@7scstores.com", passwordHash: pw, role: "EMPLOYEE", locationId: location.id },
    ],
  });
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });

  console.log("Creating vendors & products…");
  const vendors = await Promise.all([
    prisma.vendor.create({ data: { name: "Valero Fuel Supply", contact: "orders@valero.example", terms: "Net 7", balanceOwed: 12450.0 } }),
    prisma.vendor.create({ data: { name: "Core-Mark Distribution", contact: "support@coremark.example", terms: "Net 30", balanceOwed: 3820.5 } }),
    prisma.vendor.create({ data: { name: "Coca-Cola Bottling", contact: "sales@cocacola.example", terms: "Net 15", balanceOwed: 0 } }),
    prisma.vendor.create({ data: { name: "State Lottery Commission", contact: "settlements@lottery.example", terms: "Weekly", balanceOwed: 0 } }),
  ]);

  const products = await Promise.all(
    [
      ["Marlboro Gold Pack", "TOBACCO", 7.2, 9.49, 48, 20],
      ["Coca-Cola 20oz", "FOOD_DRINK", 1.1, 2.49, 120, 24],
      ["Monster Energy", "FOOD_DRINK", 1.65, 3.49, 60, 18],
      ["Lay's Chips", "STORE", 1.2, 2.29, 75, 20],
      ["Motor Oil 1qt", "STORE", 4.1, 7.99, 22, 6],
      ["Coffee 16oz", "FOOD_DRINK", 0.45, 1.99, 999, 0],
    ].map(([name, category, currentCost, sellingPrice, qtyOnHand, lowThreshold]) =>
      prisma.product.create({
        data: {
          locationId: location.id,
          name: name as string,
          category: category as never,
          currentCost: currentCost as number,
          sellingPrice: sellingPrice as number,
          qtyOnHand: qtyOnHand as number,
          lowThreshold: lowThreshold as number,
        },
      })
    )
  );

  console.log("Generating 60 days of history…");
  const DAYS = 60;
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  for (let d = DAYS; d >= 0; d--) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const weekend = [0, 6].includes(date.getDay());
    const traffic = weekend ? 1.25 : 1;

    // ---- Fuel sales per grade ----
    for (const grade of GRADES) {
      const gallons = Math.round(rand(180, 520) * traffic * (grade === "REGULAR" ? 1.6 : grade === "DIESEL" ? 0.7 : 1));
      const price = +(GRADE_BASE_PRICE[grade] + rand(-0.08, 0.12)).toFixed(4);
      const cost = +(GRADE_COST[grade] + rand(-0.03, 0.05)).toFixed(4);
      const total = +(gallons * price).toFixed(2);
      const paymentType = Math.random() < 0.62 ? "CARD" : "CASH";
      const taxCollected = 0; // fuel tax embedded in pump price, not store sales tax
      const sale = await prisma.sale.create({
        data: {
          date,
          locationId: location.id,
          category: "FUEL",
          paymentType: paymentType as never,
          amount: total,
          taxCollected,
          note: `${grade} fuel`,
        },
      });
      await prisma.fuelSale.create({
        data: {
          saleId: sale.id,
          date,
          locationId: location.id,
          grade: grade as never,
          gallons,
          pricePerGallon: price,
          total,
          taxPerGallon: FUEL_TAX,
          costPerGallon: cost,
        },
      });
    }

    // ---- Store-side sales (several category rows per day) ----
    const storeRows: [string, number, number][] = [
      ["STORE", rand(220, 560) * traffic, 0.07],
      ["FOOD_DRINK", rand(160, 420) * traffic, 0.07],
      ["TOBACCO", rand(180, 480) * traffic, 0.0],
      ["LOTTERY", rand(40, 120) * traffic, 0.0], // commission only
      ["OTHER", rand(20, 90) * traffic, 0.07],
    ];
    for (const [category, base, taxRate] of storeRows) {
      const amount = +base.toFixed(2);
      const tax = +(amount * taxRate).toFixed(2);
      await prisma.sale.create({
        data: {
          date,
          locationId: location.id,
          category: category as never,
          paymentType: (Math.random() < 0.5 ? "CARD" : "CASH") as never,
          amount,
          taxCollected: tax,
          refund: Math.random() < 0.05 ? +rand(2, 15).toFixed(2) : 0,
        },
      });
    }

    // ---- Occasional expenses ----
    if (date.getDate() === 1) {
      await prisma.expense.create({ data: { date, locationId: location.id, category: "RENT_MORTGAGE", amount: 4800, payee: "Springfield Realty", recurring: true, paymentMethod: "OTHER" } });
      await prisma.expense.create({ data: { date, locationId: location.id, category: "INSURANCE", amount: 720, payee: "Allstate Commercial", recurring: true, paymentMethod: "CARD" } });
    }
    if (date.getDay() === 5) {
      await prisma.expense.create({ data: { date, locationId: location.id, category: "PAYROLL", amount: +rand(2100, 2600).toFixed(2), payee: "Staff Payroll", paymentMethod: "OTHER" } });
    }
    if (Math.random() < 0.25) {
      const cat = pick(["UTILITIES", "REPAIRS_MAINTENANCE", "BANK_FEES", "CARD_PROCESSING_FEES", "INTERNET_PHONE"] as const);
      await prisma.expense.create({ data: { date, locationId: location.id, category: cat as never, amount: +rand(40, 380).toFixed(2), payee: "Misc Vendor", paymentMethod: "CARD" } });
    }

    // ---- Purchases / restocks ----
    if (Math.random() < 0.4) {
      const product = pick(products);
      const qty = Math.round(rand(10, 60));
      const costEach = +(product.currentCost * rand(0.95, 1.05)).toFixed(2);
      await prisma.purchase.create({
        data: {
          locationId: location.id,
          vendorId: pick(vendors).id,
          invoiceNo: `INV-${Math.floor(rand(10000, 99999))}`,
          date,
          productId: product.id,
          productName: product.name,
          qty,
          costEach,
          total: +(qty * costEach).toFixed(2),
          sellPrice: product.sellingPrice,
          paid: Math.random() < 0.6,
        },
      });
    }

    // ---- Weekly fuel delivery ----
    if (date.getDay() === 2) {
      const grade = pick(GRADES);
      const gallons = Math.round(rand(3000, 6000));
      const cost = +(GRADE_COST[grade] + rand(-0.02, 0.04)).toFixed(4);
      await prisma.fuelDelivery.create({
        data: {
          locationId: location.id,
          vendorId: vendors[0].id,
          date,
          grade: grade as never,
          gallons,
          costPerGallon: cost,
          taxPerGallon: FUEL_TAX,
          total: +(gallons * cost).toFixed(2),
          invoiceNo: `FUEL-${Math.floor(rand(1000, 9999))}`,
        },
      });
    }
  }

  console.log("Creating fuel inventory snapshots…");
  for (const grade of GRADES) {
    const book = Math.round(rand(4000, 9000));
    const physical = book - Math.round(rand(-80, 120));
    await prisma.fuelInventory.create({
      data: {
        locationId: location.id,
        grade: grade as never,
        date: today,
        gallonsBook: book,
        gallonsPhysical: physical,
        variance: physical - book,
      },
    });
  }

  console.log("Creating a sample shift + alerts + thresholds…");
  await prisma.shift.create({
    data: {
      locationId: location.id,
      userId: owner.id,
      date: today,
      startTime: new Date(today.getTime() - 8 * 3600 * 1000),
      endTime: today,
      openCash: 300,
      closeCash: 1240.5,
      expectedCash: 1255.0,
      variance: -14.5,
      cashDrop: 800,
      note: "Evening shift",
    },
  });

  await prisma.alertSetting.createMany({
    data: [
      { key: "lowProfitDay", value: 500, enabled: true },
      { key: "highExpense", value: 1000, enabled: true },
      { key: "lowInventory", value: 10, enabled: true },
      { key: "unusualSalesDropPct", value: 30, enabled: true },
    ],
  });

  await prisma.alert.createMany({
    data: [
      { locationId: location.id, type: "VENDOR_PAYMENT_DUE", severity: "warning", message: "Valero Fuel Supply balance of $12,450.00 is due (Net 7)." },
      { locationId: location.id, type: "LOW_INVENTORY", severity: "warning", message: "Motor Oil 1qt is below its reorder threshold." },
      { locationId: location.id, type: "MONTHLY_REPORT_READY", severity: "info", message: "Last month's P&L statement is ready to review." },
    ],
  });

  // ---- Phase 2/3 demo data ----
  // Single location for now (Henderson). Add more later via the Locations page.

  console.log("Creating employees & payroll…");
  const employees = await Promise.all([
    prisma.employee.create({ data: { locationId: location.id, name: "Dana Cashier", position: "Cashier", hourlyRate: 15.5 } }),
    prisma.employee.create({ data: { locationId: location.id, name: "Sam Attendant", position: "Attendant", hourlyRate: 16.0 } }),
    prisma.employee.create({ data: { locationId: location.id, name: "Priya Lead", position: "Shift Lead", hourlyRate: 19.0 } }),
  ]);
  for (let w = 0; w < 4; w++) {
    const end = new Date(today);
    end.setDate(end.getDate() - w * 7);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    for (const emp of employees) {
      const hours = +rand(28, 40).toFixed(1);
      await prisma.payrollEntry.create({
        data: {
          locationId: location.id,
          employeeId: emp.id,
          periodStart: start,
          periodEnd: end,
          hours,
          grossPay: +(hours * emp.hourlyRate).toFixed(2),
        },
      });
    }
  }

  console.log("Creating bank transactions…");
  for (let i = 0; i < 12; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i * 3);
    const debit = Math.random() < 0.7;
    await prisma.bankTransaction.create({
      data: {
        locationId: location.id,
        date,
        description: debit ? pick(["Card processing fee", "Utility autopay", "Vendor ACH", "Bank service charge"]) : "Card settlement deposit",
        amount: +rand(50, 1800).toFixed(2),
        kind: debit ? "DEBIT" : "CREDIT",
      },
    });
  }

  console.log("Creating a sync log entry…");
  await prisma.syncLog.create({
    data: {
      source: "POS_MODI",
      status: "SUCCESS",
      locationId: location.id,
      finishedAt: today,
      recordsImported: 0,
      message: "Initial sandbox sync.",
    },
  });

  await prisma.setting.createMany({
    data: [
      { key: "emailEnabled", value: "false" },
      { key: "smsEnabled", value: "false" },
      { key: "notifyEmail", value: "owner@7scstores.com" },
      { key: "notifyPhone", value: "" },
    ],
  });

  console.log("✅ Seed complete.");
  console.log("   Login: owner@7scstores.com / password123 (and manager@, accountant@, employee@)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
