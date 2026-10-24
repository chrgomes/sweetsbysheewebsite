import { describe, expect, it } from "vitest";
import { isLineError, normalizeCart, priceLine, type PricedProduct } from "@/lib/pricing";

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
  options: [
    {
      id: "o1",
      name: "Size",
      required: true,
      values: [
        { id: "small", label: '6"', priceDeltaCents: 0, available: true },
        { id: "large", label: '8"', priceDeltaCents: 1500, available: true },
        { id: "gone", label: '10"', priceDeltaCents: 3000, available: false },
      ],
    },
    { id: "o2", name: "Topper", required: false, values: [{ id: "topper", label: "Gold", priceDeltaCents: 500, available: true }] },
  ],
};

const line = (optionValueIds: string[], quantity = 1) => priceLine(product, { productId: product.id, optionValueIds, quantity });

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
  it("merges duplicate cart lines regardless of option order", () => {
    const merged = normalizeCart([
      { productId: "p", optionValueIds: ["b", "a"], quantity: 1 },
      { productId: "p", optionValueIds: ["a", "b"], quantity: 2 },
      { productId: "p", optionValueIds: ["a"], quantity: 1 },
    ]);
    expect(merged).toEqual([
      { productId: "p", optionValueIds: ["a", "b"], quantity: 3 },
      { productId: "p", optionValueIds: ["a"], quantity: 1 },
    ]);
  });
});
