/**
 * Pure recipe arithmetic shared by stock consumption and costing. Quantities
 * are in each ingredient's base unit (g, ml or each) and rounded to 3 decimals,
 * matching the numeric(14,3) columns. Costs are cents per base unit.
 */

export type RecipeForMath = { yieldQuantity: number; items: { ingredientId: string; quantity: number }[] };

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Ingredients used by a set of order lines: each line uses
 * quantity ÷ yield batches of its product's recipe. Lines whose product has no
 * recipe are reported so staff can see what wasn't counted.
 */
export function ingredientNeeds(lines: { productId: string | null; quantity: number }[], recipes: Map<string, RecipeForMath>) {
  const needs = new Map<string, number>();
  const uncounted = new Set<string>();
  for (const line of lines) {
    if (!line.productId) continue;
    const recipe = recipes.get(line.productId);
    if (!recipe || recipe.items.length === 0 || recipe.yieldQuantity <= 0) {
      uncounted.add(line.productId);
      continue;
    }
    const batches = line.quantity / recipe.yieldQuantity;
    for (const item of recipe.items) needs.set(item.ingredientId, (needs.get(item.ingredientId) ?? 0) + item.quantity * batches);
  }
  for (const [k, v] of needs) needs.set(k, round3(v));
  return { needs, uncounted: [...uncounted] };
}

/**
 * Ingredient cost of one unit of a product, in cents. `missing` lists
 * ingredients without a known cost; the total then understates the real cost.
 */
export function recipeUnitCost(recipe: RecipeForMath, costPerUnitCents: Map<string, number | null>) {
  if (recipe.yieldQuantity <= 0) return { cents: null, missing: [] as string[] };
  let total = 0;
  const missing: string[] = [];
  for (const item of recipe.items) {
    const cost = costPerUnitCents.get(item.ingredientId);
    if (cost === null || cost === undefined) missing.push(item.ingredientId);
    else total += cost * item.quantity;
  }
  return { cents: recipe.items.length ? Math.round(total / recipe.yieldQuantity) : null, missing };
}

/** Gross margin as a fraction of the price, or null when either side is unknown. */
export function marginOf(priceCents: number | null, costCents: number | null): number | null {
  if (priceCents === null || costCents === null || priceCents <= 0) return null;
  return (priceCents - costCents) / priceCents;
}

/** "1,250 g", "2.5 ml", "12 each" */
export function formatQuantity(n: number, unit: string): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n)} ${unit}`;
}

/** Costs per base unit are tiny for g/ml, so show them per kg / L. */
export function unitCostDisplay(centsPerUnit: number, unit: string): { cents: number; per: string } {
  if (unit === "g") return { cents: centsPerUnit * 1000, per: "kg" };
  if (unit === "ml") return { cents: centsPerUnit * 1000, per: "L" };
  return { cents: centsPerUnit, per: unit };
}

/** Inverse of unitCostDisplay: a price per kg / L / each back to cents per base unit. */
export function centsPerBaseUnit(centsPerDisplayUnit: number, unit: string): number {
  return unit === "g" || unit === "ml" ? centsPerDisplayUnit / 1000 : centsPerDisplayUnit;
}
