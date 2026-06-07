/**
 * Reorder suggestions (Phase 3). Flags products at/below their low-stock
 * threshold and proposes an order quantity based on recent purchase cadence.
 */
import { prisma } from "./db";

export interface ReorderSuggestion {
  productId: string;
  name: string;
  qtyOnHand: number;
  threshold: number;
  suggestedQty: number;
  lastCostEach: number;
  estimatedCost: number;
}

export async function reorderSuggestions(locationId?: string): Promise<ReorderSuggestion[]> {
  const products = await prisma.product.findMany({
    where: { lowThreshold: { not: null }, ...(locationId ? { locationId } : {}) },
  });
  const lowProducts = products.filter((p) => p.lowThreshold != null && p.qtyOnHand <= p.lowThreshold);
  if (lowProducts.length === 0) return [];

  const suggestions: ReorderSuggestion[] = [];
  for (const p of lowProducts) {
    const recent = await prisma.purchase.findMany({
      where: { productId: p.id },
      orderBy: { date: "desc" },
      take: 5,
    });
    const threshold = p.lowThreshold ?? 0;
    // Target a comfortable buffer: average recent order size, or twice the
    // threshold if we have no purchase history to learn from.
    const avgQty =
      recent.length > 0
        ? recent.reduce((s, r) => s + r.qty, 0) / recent.length
        : threshold * 2;
    const suggestedQty = Math.max(1, Math.ceil(threshold * 2 - p.qtyOnHand + avgQty * 0.5));
    const lastCostEach = recent[0]?.costEach ?? p.currentCost;
    suggestions.push({
      productId: p.id,
      name: p.name,
      qtyOnHand: p.qtyOnHand,
      threshold,
      suggestedQty,
      lastCostEach,
      estimatedCost: Math.round(suggestedQty * lastCostEach * 100) / 100,
    });
  }
  return suggestions;
}
