/**
 * Server-authoritative pricing. The browser only ever sends product IDs,
 * option-value IDs and quantities; every price is recomputed here from the
 * database. Pure functions so the rules are easy to test.
 */

export const MAX_LINE_QUANTITY = 50;
export const MAX_CART_LINES = 30;

export type PricedProduct = {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "active" | "unavailable" | "archived";
  basePriceCents: number | null;
  currency: string;
  directPurchase: boolean;
  leadTimeHours: number | null;
  pickupEligible: boolean;
  deliveryEligible: boolean;
  maxPerOrder: number | null;
  image?: { src: string; alt: string } | null;
  options: {
    id: string;
    name: string;
    required: boolean;
    values: { id: string; label: string; priceDeltaCents: number; available: boolean }[];
  }[];
};

export type CartLineInput = { productId: string; optionValueIds: string[]; quantity: number };

export type PricedLine = {
  key: string;
  productId: string;
  slug: string;
  name: string;
  image: { src: string; alt: string } | null;
  options: { option: string; value: string; priceDeltaCents: number }[];
  optionValueIds: string[];
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  leadTimeHours: number | null;
  pickupEligible: boolean;
  deliveryEligible: boolean;
};

export type LineError = { productId: string; key: string; message: string };

export function lineKey(productId: string, optionValueIds: string[]): string {
  return [productId, ...[...optionValueIds].sort()].join(":");
}

export function isPurchasable(p: Pick<PricedProduct, "status" | "directPurchase" | "basePriceCents">): boolean {
  return p.status === "active" && p.directPurchase && p.basePriceCents !== null;
}

export function priceLine(product: PricedProduct | undefined, input: CartLineInput): PricedLine | LineError {
  const key = lineKey(input.productId, input.optionValueIds);
  const fail = (message: string): LineError => ({ productId: input.productId, key, message });

  if (!product) return fail("This item is no longer available.");
  if (!isPurchasable(product)) return fail(`${product.name} isn't available to order online right now.`);
  if (!Number.isInteger(input.quantity) || input.quantity < 1) return fail("Quantity must be at least 1.");
  const maxQty = Math.min(product.maxPerOrder ?? MAX_LINE_QUANTITY, MAX_LINE_QUANTITY);
  if (input.quantity > maxQty) return fail(`You can order up to ${maxQty} of ${product.name} at once.`);

  const chosen = new Set(input.optionValueIds);
  if (chosen.size !== input.optionValueIds.length) return fail("Duplicate options were selected.");

  const selected: PricedLine["options"] = [];
  let consumed = 0;
  for (const option of product.options) {
    const matches = option.values.filter((v) => chosen.has(v.id));
    if (matches.length > 1) return fail(`Choose only one ${option.name.toLowerCase()}.`);
    const value = matches[0];
    if (!value) {
      if (option.required) return fail(`Please choose a ${option.name.toLowerCase()} for ${product.name}.`);
      continue;
    }
    if (!value.available) return fail(`${option.name} "${value.label}" is unavailable.`);
    selected.push({ option: option.name, value: value.label, priceDeltaCents: value.priceDeltaCents });
    consumed++;
  }
  if (consumed !== chosen.size) return fail("Some selected options don't belong to this product.");

  const unit = product.basePriceCents! + selected.reduce((sum, o) => sum + o.priceDeltaCents, 0);
  if (unit < 0) return fail("This combination can't be priced. Please contact us.");

  return {
    key,
    productId: product.id,
    slug: product.slug,
    name: product.name,
    image: product.image ?? null,
    options: selected,
    optionValueIds: [...input.optionValueIds].sort(),
    unitPriceCents: unit,
    quantity: input.quantity,
    lineTotalCents: unit * input.quantity,
    leadTimeHours: product.leadTimeHours,
    pickupEligible: product.pickupEligible,
    deliveryEligible: product.deliveryEligible,
  };
}

export function isLineError(x: PricedLine | LineError): x is LineError {
  return "message" in x && !("unitPriceCents" in x);
}

/** Merge duplicate lines (same product + options) so quantities add up. */
export function normalizeCart(lines: CartLineInput[]): CartLineInput[] {
  const merged = new Map<string, CartLineInput>();
  for (const l of lines) {
    const k = lineKey(l.productId, l.optionValueIds);
    const prev = merged.get(k);
    if (prev) prev.quantity += l.quantity;
    else merged.set(k, { productId: l.productId, optionValueIds: [...l.optionValueIds].sort(), quantity: l.quantity });
  }
  return [...merged.values()];
}
