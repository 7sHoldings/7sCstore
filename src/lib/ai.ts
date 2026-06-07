/**
 * AI business insights (Phase 3). When ANTHROPIC_API_KEY is set we ask Claude to
 * interpret the period's numbers; otherwise we fall back to deterministic
 * rule-based insights so the feature always returns something useful.
 */
import "server-only";
import type { DashboardData } from "./reports";
import { fmtMoney, fmtPct } from "./format";

export interface Insight {
  title: string;
  detail: string;
  tone: "positive" | "warning" | "neutral";
}

export interface InsightResult {
  source: "ai" | "rules";
  insights: Insight[];
}

function summarize(d: DashboardData): string {
  const topFuel = [...d.fuel.byGrade].sort((a, b) => b.profit - a.profit)[0];
  return [
    `Period: ${d.range.label}`,
    `Gross sales: ${fmtMoney(d.pnl.grossSales)}`,
    `Net sales: ${fmtMoney(d.pnl.netSales)}`,
    `COGS: ${fmtMoney(d.pnl.cogs)}`,
    `Gross profit: ${fmtMoney(d.pnl.grossProfit)}`,
    `Operating expenses: ${fmtMoney(d.pnl.operatingExpenses)}`,
    `Net profit: ${fmtMoney(d.pnl.netProfit)} (margin ${d.pnl.profitMargin}%)`,
    `Fuel sales: ${fmtMoney(d.fuel.total)} over ${d.fuel.gallons} gal; fuel profit ${fmtMoney(d.pnl.fuelProfit)}`,
    `Store sales: ${fmtMoney(d.store.total)}`,
    `Cash vs card: ${fmtMoney(d.payment.cash)} / ${fmtMoney(d.payment.card)}`,
    `Net sales vs previous period: ${fmtPct(d.comparison.netSales)}`,
    `Net profit vs previous period: ${fmtPct(d.comparison.netProfit)}`,
    topFuel ? `Most profitable grade: ${topFuel.grade} (${fmtMoney(topFuel.profit)})` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Deterministic insights derived directly from the numbers. */
function ruleBased(d: DashboardData): Insight[] {
  const out: Insight[] = [];
  const p = d.pnl;

  if (p.netSales > 0) {
    out.push({
      title: `Net margin is ${p.profitMargin}%`,
      detail:
        p.profitMargin >= 10
          ? "Healthy margin for a fuel-led business. Keep an eye on fuel cost swings."
          : p.profitMargin >= 3
          ? "Margin is thin — typical for fuel-heavy mix. Growing in-store sales lifts overall margin."
          : "Margin is very low. Review fuel pricing and high operating expenses.",
      tone: p.profitMargin >= 10 ? "positive" : p.profitMargin >= 3 ? "neutral" : "warning",
    });
  }

  if (d.comparison.netProfit !== null) {
    out.push({
      title: `Net profit ${d.comparison.netProfit >= 0 ? "up" : "down"} ${fmtPct(d.comparison.netProfit)} vs last period`,
      detail:
        d.comparison.netProfit >= 0
          ? "Profit is trending up. Whatever changed recently is working."
          : "Profit slipped versus the previous period. Compare expenses and fuel cost between the two.",
      tone: d.comparison.netProfit >= 0 ? "positive" : "warning",
    });
  }

  const total = d.fuel.total + d.store.total;
  if (total > 0) {
    const storePct = Math.round((d.store.total / total) * 100);
    out.push({
      title: `Store is ${storePct}% of sales`,
      detail:
        storePct < 25
          ? "In-store sales are a small share. Convenience items carry far higher margins than fuel — a promo or better placement could help."
          : "Solid in-store contribution, which protects you from thin fuel margins.",
      tone: storePct < 25 ? "neutral" : "positive",
    });
  }

  const expenseRatio = p.netSales > 0 ? (p.operatingExpenses / p.netSales) * 100 : 0;
  if (expenseRatio > 0) {
    out.push({
      title: `Operating expenses are ${Math.round(expenseRatio)}% of net sales`,
      detail:
        expenseRatio > 20
          ? "Expense load is high relative to sales. Review the largest expense categories on the Reports page."
          : "Expense ratio looks controlled.",
      tone: expenseRatio > 20 ? "warning" : "positive",
    });
  }

  const best = [...d.fuel.byGrade].sort((a, b) => b.profit - a.profit)[0];
  if (best) {
    out.push({
      title: `${best.grade} fuel is your profit leader`,
      detail: `It contributed ${fmtMoney(best.profit)} at a margin of $${best.margin.toFixed(4)}/gal this period.`,
      tone: "neutral",
    });
  }

  return out;
}

async function viaClaude(d: DashboardData): Promise<Insight[] | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.AI_MODEL || "claude-sonnet-4-6";

  const prompt = `You are a financial analyst for a gas station / convenience store. Given the period figures below, return 3-5 concise, actionable insights.
Respond ONLY with a JSON array; each item: {"title": string (<=60 chars), "detail": string (<=200 chars), "tone": "positive"|"warning"|"neutral"}.

${summarize(d)}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Insight[];
    return parsed
      .filter((i) => i && i.title && i.detail)
      .map((i) => ({
        title: String(i.title),
        detail: String(i.detail),
        tone: ["positive", "warning", "neutral"].includes(i.tone) ? i.tone : "neutral",
      }));
  } catch (e) {
    console.error("AI insight error", e);
    return null;
  }
}

export async function generateInsights(d: DashboardData): Promise<InsightResult> {
  const ai = await viaClaude(d);
  if (ai && ai.length) return { source: "ai", insights: ai };
  return { source: "rules", insights: ruleBased(d) };
}
