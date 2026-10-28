import { describe, expect, it } from "vitest";
import { depositFor, discountAmount, isLineError, lineKey, normalizeCart, orderTotals, priceLine, type PricedProduct } from "@/lib/pricing";

const product: PricedProduct = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Celebration Cake",
  slug: "celebration-cake",
  status: "active",
  basePriceCents: 4000,
  currency: "usd",
  directPurchase: true,
  leadTimeHours: 72,
  pickupEligible: true,
  deliveryEligible: false,
  maxPerOrder: 3,
  capacityUnits: 2,
  options: [
    {
      id: "o1",
      name: "Size",
      kind: "choice",
      maxLength: null,
      priceDeltaCents: 0,
      required: true,
      values: [
        { id: "small", label: '6"', priceDeltaCents: 0, available: true },
        { id: "large", label: '8"', priceDeltaCents: 1500, available: true },
        { id: "gone", label: '10"', priceDeltaCents: 3000, available: false },
      ],
    },
    { id: "o2", name: "Topper", kind: "choice", maxLength: null, priceDeltaCents: 0, required: false, values: [{ id: "topper", label: "Gold", priceDeltaCents: 500, available: true }] },
    { id: "o3", name: "Message", kind: "text", maxLength: 12, priceDeltaCents: 250, required: false, values: [] },
  ],
};

const line = (optionValueIds: string[], quantity = 1, texts?: { optionId: string; value: string }[]) => priceLine(product, { productId: product.id, optionValueIds, quantity, texts });

describe("priceLine", () => {
  it("prices base + selected option deltas", () => {
    const l = line(["large", "topper"], 2);
    expect(isLineError(l)).toBe(false);
    if (!isLineError(l)) {
      expect(l.unitPriceCents).toBe(6000);
      expect(l.lineTotalCents).toBe(12000);
      expect(l.options.map((o) => o.value)).toEqual(['8"', "Gold"]);
    }
  });
  it("requires required options", () => expect(line(["topper"])).toMatchObject({ message: expect.stringMatching(/choose a size/i) }));
  it("rejects two values for one option", () => expect(line(["small", "large"])).toMatchObject({ message: expect.stringMatching(/only one/i) }));
  it("rejects unavailable values", () => expect(line(["gone"])).toMatchObject({ message: expect.stringMatching(/unavailable/) }));
  it("rejects option values from other products", () => expect(line(["small", "foreign"])).toMatchObject({ message: expect.stringMatching(/don't belong/) }));
  it("enforces quantity limits", () => {
    expect(line(["small"], 0)).toMatchObject({ message: expect.stringMatching(/at least 1/) });
    expect(line(["small"], 4)).toMatchObject({ message: expect.stringMatching(/up to 3/) });
    expect(line(["small"], 1.5)).toMatchObject({ message: expect.any(String) });
  });
  it("refuses products that can't be bought online", () => {
    for (const p of [{ status: "unavailable" as const }, { directPurchase: false }, { basePriceCents: null }]) {
      expect(isLineError(priceLine({ ...product, ...p }, { productId: product.id, optionValueIds: ["small"], quantity: 1 }))).toBe(true);
    }
    expect(isLineError(priceLine(undefined, { productId: product.id, optionValueIds: [], quantity: 1 }))).toBe(true);
  });
  it("merges duplicate cart lines regardless of option order, keeping different messages apart", () => {
    const merged = normalizeCart([
      { productId: "p", optionValueIds: ["b", "a"], quantity: 1 },
      { productId: "p", optionValueIds: ["a", "b"], quantity: 2 },
      { productId: "p", optionValueIds: ["a"], quantity: 1 },
      { productId: "p", optionValueIds: ["a"], texts: [{ optionId: "m", value: "Hi  Sam" }], quantity: 1 },
      { productId: "p", optionValueIds: ["a"], texts: [{ optionId: "m", value: "Hi Sam" }], quantity: 1 },
    ]);
    expect(merged).toEqual([
      { productId: "p", optionValueIds: ["a", "b"], texts: [], quantity: 3 },
      { productId: "p", optionValueIds: ["a"], texts: [], quantity: 1 },
      { productId: "p", optionValueIds: ["a"], texts: [{ optionId: "m", value: "Hi Sam" }], quantity: 2 },
    ]);
    expect(lineKey("p", ["a"], [{ optionId: "m", value: "x" }])).not.toBe(lineKey("p", ["a"]));
  });

  it("prices personalisation text and enforces its length and ownership", () => {
    const l = line(["small"], 2, [{ optionId: "o3", value: " Happy  30th " }]);
    expect(isLineError(l)).toBe(false);
    if (!isLineError(l)) {
      expect(l.unitPriceCents).toBe(4250);
      expect(l.options).toContainEqual({ option: "Message", value: "Happy 30th", priceDeltaCents: 250 });
      expect(l.capacityUnits).toBe(4);
    }
    expect(line(["small"], 1, [{ optionId: "o3", value: "x".repeat(13) }])).toMatchObject({ message: expect.stringMatching(/at most 12/) });
    expect(line(["small"], 1, [{ optionId: "nope", value: "hi" }])).toMatchObject({ message: expect.stringMatching(/don't belong/) });
    // Blank text counts as not filled in: no surcharge.
    const blank = line(["small"], 1, [{ optionId: "o3", value: "   " }]);
    expect(!isLineError(blank) && blank.unitPriceCents).toBe(4000);
  });
});

describe("totals, discounts and deposits", () => {
  it("computes discounts within their rules", () => {
    expect(discountAmount({ kind: "percent", value: 1000, minSubtotalCents: 0 }, 4550)).toBe(455);
    expect(discountAmount({ kind: "percent", value: 1250, minSubtotalCents: 0 }, 999)).toBe(125); // 124.875 → 125
    expect(discountAmount({ kind: "fixed", value: 5000, minSubtotalCents: 0 }, 3000)).toBe(3000); // never more than the subtotal
    expect(discountAmount({ kind: "fixed", value: 500, minSubtotalCents: 4000 }, 3999)).toBe(0);
  });
  it("taxes subtotal minus discount plus delivery", () => {
    expect(orderTotals({ subtotalCents: 10000, discountCents: 1000, deliveryFeeCents: 1500, taxRateBps: 825 })).toEqual({
      subtotalCents: 10000,
      discountCents: 1000,
      deliveryFeeCents: 1500,
      taxableCents: 10500,
      taxCents: 866,
      totalCents: 11366,
    });
    expect(orderTotals({ subtotalCents: 500, discountCents: 900, taxRateBps: 0 }).totalCents).toBe(0);
  });
  it("computes deposits", () => {
    expect(depositFor(27000, 5000)).toBe(13500);
    expect(depositFor(27001, 3333)).toBe(8999);
    expect(depositFor(27000, null)).toBe(0);
  });
});
