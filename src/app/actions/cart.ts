"use server";

import { redirect } from "next/navigation";
import { log } from "@/lib/log";
import { cartSchema, checkoutSchema, earliestDateFor, placeOrder, quoteCart, type DiscountQuote } from "@/lib/orders";
import type { LineError, PricedLine } from "@/lib/pricing";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { fieldErrors } from "@/lib/validation";

export type QuoteResponse = {
  lines: PricedLine[];
  errors: LineError[];
  subtotalCents: number;
  discount: DiscountQuote | null;
  currency: string;
  leadTimeHours: number;
  earliestDate: string | null;
  /** Upcoming dates that are fully booked for this cart. */
  fullDates: string[];
  pickupAvailable: boolean;
  deliveryAvailable: boolean;
};

const EMPTY: QuoteResponse = { lines: [], errors: [], subtotalCents: 0, discount: null, currency: "usd", leadTimeHours: 0, earliestDate: null, fullDates: [], pickupAvailable: false, deliveryAvailable: false };

/** Re-price the browser's cart from the database (optionally with a discount code). */
export async function quoteAction(raw: unknown, discountCode?: string | null): Promise<QuoteResponse> {
  const parsed = cartSchema.safeParse(raw);
  if (!parsed.success) return { ...EMPTY, errors: [{ productId: "", key: "", message: "Your cart couldn't be read and has been reset." }] };
  if (discountCode) {
    // Code guessing is cheap to try, so it's rate-limited per visitor.
    const limit = await rateLimit("discount", await clientIp(), 20, 600);
    if (!limit.allowed) discountCode = null;
  }
  const s = await getSettings();
  const q = await quoteCart(parsed.data, s, { discountCode: typeof discountCode === "string" ? discountCode.slice(0, 40) : null });
  const { earliest, full } = q.lines.length ? await earliestDateFor(q, s) : { earliest: null, full: [] };
  return { ...q, earliestDate: earliest, fullDates: full };
}

export type CheckoutState = { message?: string; fieldErrors?: Record<string, string>; lineErrors?: LineError[]; values?: Record<string, string> };

const ECHO_FIELDS = ["customerName", "customerEmail", "customerPhone", "fulfillmentDate", "fulfillmentWindow", "line1", "line2", "city", "region", "postalCode", "notes", "discountCode"] as const;

export async function checkoutAction(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  // Echoed back so the form keeps what the customer typed when it shows errors.
  const values: Record<string, string> = {};
  for (const k of ECHO_FIELDS) {
    const v = form.get(k);
    if (typeof v === "string") values[k] = v.slice(0, 2000);
  }
  const limit = await rateLimit("checkout", await clientIp(), 10, 600);
  if (!limit.allowed) return { message: "Too many attempts. Please wait a few minutes and try again.", values };

  let cart: unknown;
  try {
    cart = JSON.parse(String(form.get("cart") ?? "[]"));
  } catch {
    return { message: "Your cart couldn't be read. Please refresh the page.", values };
  }
  const delivery = form.get("fulfillmentMethod") === "delivery";
  const parsed = checkoutSchema.safeParse({
    cart,
    customerName: form.get("customerName"),
    customerEmail: form.get("customerEmail"),
    customerPhone: form.get("customerPhone") ?? undefined,
    fulfillmentMethod: form.get("fulfillmentMethod"),
    fulfillmentDate: form.get("fulfillmentDate"),
    fulfillmentWindow: form.get("fulfillmentWindow") ?? undefined,
    deliveryAddress: delivery
      ? { line1: form.get("line1"), line2: form.get("line2") ?? undefined, city: form.get("city"), region: form.get("region"), postalCode: form.get("postalCode") }
      : undefined,
    notes: form.get("notes") ?? undefined,
    discountCode: form.get("discountCode") ?? undefined,
  });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    // Flatten "deliveryAddress.line1" -> "line1" to match form field names.
    const flat = Object.fromEntries(Object.entries(errors).map(([k, v]) => [k.replace(/^deliveryAddress\./, ""), v]));
    return { message: "Please check the highlighted fields.", fieldErrors: flat, values };
  }

  const result = await placeOrder(parsed.data);
  if (!result.ok) {
    log.warn("checkout.rejected", { message: result.message });
    return { message: result.message, fieldErrors: result.fieldErrors, lineErrors: result.lineErrors, values };
  }
  redirect(result.redirectUrl);
}
