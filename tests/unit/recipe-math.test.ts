import { describe, expect, it } from "vitest";
import { formatQuantity, ingredientNeeds, marginOf, recipeUnitCost, type RecipeForMath } from "@/lib/recipe-math";

const cake: RecipeForMath = { yieldQuantity: 1, items: [{ ingredientId: "flour", quantity: 250 }, { ingredientId: "eggs", quantity: 4 }] };
const cupcakes: RecipeForMath = { yieldQuantity: 12, items: [{ ingredientId: "flour", quantity: 300 }, { ingredientId: "butter", quantity: 200 }] };

describe("ingredientNeeds", () => {
  it("scales each line by quantity ÷ yield and sums across lines", () => {
    const recipes = new Map([["cake", cake], ["cup", cupcakes]]);
    const { needs, uncounted } = ingredientNeeds(
      [
        { productId: "cake", quantity: 2 },
        { productId: "cup", quantity: 6 },
        { productId: "bread", quantity: 1 },
        { productId: null, quantity: 3 },
      ],
      recipes,
    );
    expect(Object.fromEntries(needs)).toEqual({ flour: 650, eggs: 8, butter: 100 });
    expect(uncounted).toEqual(["bread"]);
  });

  it("rounds to three decimals", () => {
    const { needs } = ingredientNeeds([{ productId: "cup", quantity: 1 }], new Map([["cup", cupcakes]]));
    expect(needs.get("butter")).toBe(16.667);
  });
});

describe("costing", () => {
  it("costs one unit of the product and reports unknown ingredient costs", () => {
    // flour 0.2¢/g, eggs 30¢ each
    expect(recipeUnitCost(cake, new Map([["flour", 0.2], ["eggs", 30]]))).toEqual({ cents: 170, missing: [] });
    expect(recipeUnitCost(cupcakes, new Map([["flour", 0.2], ["butter", null]]))).toEqual({ cents: 5, missing: ["butter"] });
    expect(recipeUnitCost({ yieldQuantity: 1, items: [] }, new Map())).toEqual({ cents: null, missing: [] });
  });

  it("computes margins only when price and cost are known", () => {
    expect(marginOf(4500, 1350)).toBeCloseTo(0.7);
    expect(marginOf(null, 100)).toBeNull();
    expect(marginOf(4500, null)).toBeNull();
  });

  it("formats quantities with their unit", () => {
    expect(formatQuantity(1250, "g")).toBe("1,250 g");
    expect(formatQuantity(16.6666, "ml")).toBe("16.667 ml");
  });
});

describe("unit cost display", () => {
  it("shows grams and millilitres per kg / L and converts back", async () => {
    const { unitCostDisplay, centsPerBaseUnit } = await import("@/lib/recipe-math");
    expect(unitCostDisplay(0.2, "g")).toEqual({ cents: 200, per: "kg" });
    expect(unitCostDisplay(30, "each")).toEqual({ cents: 30, per: "each" });
    expect(centsPerBaseUnit(350, "ml")).toBe(0.35);
    expect(centsPerBaseUnit(30, "each")).toBe(30);
  });
});
