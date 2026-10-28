/**
 * Server-authoritative pricing, shared by the cart, checkout, quotes and
 * reports. The browser only ever sends product ids, option-value ids, text
 * for personalisation fields and quantities; every amount is recomputed here
 * from the database. Pure functions so the rules are easy to test.
 *
 * Money is integer cents. Rounding: percentage amounts (discounts, tax,
 * deposits) round half-up to the cent, once per order.
 */

export const MAX_LINE_QUANTITY = 50;
export const MAX_CART_LINES = 30;
export const MAX_TEXT_OPTION_LENGTH = 500;

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
  capacityUnits: number;
  image?: { src: string; alt: string } | null;
  options: {
    id: string;
    name: string;
    kind: "choice" | "text";
    required: boolean;
    maxLength: number | null;
    priceDeltaCents: number;
    values: { id: string; label: string; priceDeltaCents: number; available: boolean }[];
  }[];
};

export type TextInput = { optionId: string; value: string };
export type CartLineInput = { productId: string; optionValueIds: string[]; texts?: TextInput[]; quantity: number };

export type PricedLine = {
  key: string;
  productId: string;
  slug: string;
  name: string;
  image: { src: string; alt: string } | null;
  /** `valueId` is set for choice options and stored on the order so stock use can follow the choice. */
  options: { option: string; value: string; priceDeltaCents: number; valueId?: string }[];
  optionValueIds: string[];
  texts: TextInput[];
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  leadTimeHours: number | null;
  pickupEligible: boolean;
  deliveryEligible: boolean;
  capacityUnits: number;
};

export type LineError = { productId: string; key: string; message: string };

/** Collapse whitespace; personalisation text is stored and shown exactly as normalised here. */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanTexts(texts: TextInput[] | undefined): TextInput[] {
  return (texts ?? [])
    .map((t) => ({ optionId: t.optionId, value: normalizeText(t.value) }))
    .filter((t) => t.value !== "")
    .sort((a, b) => a.optionId.localeCompare(b.optionId));
}

/** Identity of a cart line: same product, choices and personalisation text. */
export function lineKey(productId: string, optionValueIds: string[], texts?: TextInput[]): string {
  const textPart = cleanTexts(texts)
    .map((t) => `${t.optionId}=${t.value}`)
    .join("|");
  return [productId, ...[...optionValueIds].sort(), textPart ? `t:${textPart}` : ""].filter(Boolean).join(":");
}

export function isPurchasable(p: Pick<PricedProduct, "status" | "directPurchase" | "basePriceCents">): boolean {
  return p.status === "active" && p.directPurchase && p.basePriceCents !== null;
}

export function priceLine(product: PricedProduct | undefined, input: CartLineInput): PricedLine | LineError {
  const texts = cleanTexts(input.texts);
  const key = lineKey(input.productId, input.optionValueIds, texts);
  const fail = (message: string): LineError => ({ productId: input.productId, key, message });

  if (!product) return fail("This item is no longer available.");
  if (!isPurchasable(product)) return fail(`${product.name} isn't available to order online right now.`);
  if (!Number.isInteger(input.quantity) || input.quantity < 1) return fail("Quantity must be at least 1.");
  const maxQty = Math.min(product.maxPerOrder ?? MAX_LINE_QUANTITY, MAX_LINE_QUANTITY);
  if (input.quantity > maxQty) return fail(`You can order up to ${maxQty} of ${product.name} at once.`);

  const chosen = new Set(input.optionValueIds);
  if (chosen.size !== input.optionValueIds.length) return fail("Duplicate options were selected.");
  const textById = new Map(texts.map((t) => [t.optionId, t.value]));
  if (textById.size !== texts.length) return fail("Duplicate personalisation fields were sent.");

  const selected: PricedLine["options"] = [];
  let consumedChoices = 0;
  let consumedTexts = 0;
  for (const option of product.options) {
    const label = option.name.toLowerCase();
    if (option.kind === "text") {
      const value = textById.get(option.id);
      if (value === undefined) {
        if (option.required) return fail(`Please fill in "${option.name}" for ${product.name}.`);
        continue;
      }
      const limit = Math.min(option.maxLength ?? MAX_TEXT_OPTION_LENGTH, MAX_TEXT_OPTION_LENGTH);
      if (value.length > limit) return fail(`"${option.name}" can be at most ${limit} characters.`);
      selected.push({ option: option.name, value, priceDeltaCents: option.priceDeltaCents });
      consumedTexts++;
      continue;
    }
    const matches = option.values.filter((v) => chosen.has(v.id));
    if (matches.length > 1) return fail(`Choose only one ${label}.`);
    const value = matches[0];
    if (!value) {
      if (option.required) return fail(`Please choose a ${label} for ${product.name}.`);
      continue;
    }
    if (!value.available) return fail(`${option.name} "${value.label}" is unavailable.`);
    selected.push({ option: option.name, value: value.label, priceDeltaCents: value.priceDeltaCents, valueId: value.id });
    consumedChoices++;
  }
  if (consumedChoices !== chosen.size) return fail("Some selected options don't belong to this product.");
  if (consumedTexts !== textById.size) return fail("Some personalisation fields don't belong to this product.");

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
    texts,
    unitPriceCents: unit,
    quantity: input.quantity,
    lineTotalCents: unit * input.quantity,
    leadTimeHours: product.leadTimeHours,
    pickupEligible: product.pickupEligible,
    deliveryEligible: product.deliveryEligible,
    capacityUnits: product.capacityUnits * input.quantity,
  };
}

export function isLineError(x: PricedLine | LineError): x is LineError {
  return "message" in x && !("unitPriceCents" in x);
}

/** Merge duplicate lines (same product, options and text) so quantities add up. */
export function normalizeCart(lines: CartLineInput[]): CartLineInput[] {
  const merged = new Map<string, CartLineInput>();
  for (const l of lines) {
    const texts = cleanTexts(l.texts);
    const k = lineKey(l.productId, l.optionValueIds, texts);
    const prev = merged.get(k);
    if (prev) prev.quantity += l.quantity;
    else merged.set(k, { productId: l.productId, optionValueIds: [...l.optionValueIds].sort(), texts, quantity: l.quantity });
  }
  return [...merged.values()];
}

/** Basis-point share of an amount, rounded half-up to the cent. */
export function percentOf(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10_000);
}

export type DiscountRule = { kind: "percent" | "fixed"; value: number; minSubtotalCents: number };

/** Discount on a merchandise subtotal. Never more than the subtotal; zero below the minimum. */
export function discountAmount(rule: DiscountRule, subtotalCents: number): number {
  if (subtotalCents <= 0 || subtotalCents < rule.minSubtotalCents) return 0;
  const raw = rule.kind === "percent" ? percentOf(subtotalCents, rule.value) : rule.value;
  return Math.max(0, Math.min(raw, subtotalCents));
}

export type OrderTotals = {
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
};

/** Totals for an order or quote. Tax applies to (subtotal − discount + delivery). */
export function orderTotals(p: { subtotalCents: number; discountCents?: number; deliveryFeeCents?: number; taxRateBps: number }): OrderTotals {
  const discountCents = Math.min(Math.max(0, p.discountCents ?? 0), p.subtotalCents);
  const deliveryFeeCents = Math.max(0, p.deliveryFeeCents ?? 0);
  const taxableCents = p.subtotalCents - discountCents + deliveryFeeCents;
  const taxCents = percentOf(taxableCents, p.taxRateBps);
  return { subtotalCents: p.subtotalCents, discountCents, deliveryFeeCents, taxableCents, taxCents, totalCents: taxableCents + taxCents };
}

/** Deposit for a total. Null/0 bps means no deposit (full payment). */
export function depositFor(totalCents: number, depositBps: number | null): number {
  if (!depositBps) return 0;
  return Math.min(totalCents, percentOf(totalCents, depositBps));
}
