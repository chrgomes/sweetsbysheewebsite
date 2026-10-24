"use server";

import { redirect } from "next/navigation";
import { log } from "@/lib/log";
import { cartSchema, checkoutSchema, earliestDateFor, placeOrder, quoteCart } from "@/lib/orders";
import type { LineError, PricedLine } from "@/lib/pricing";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { fieldErrors } from "@/lib/validation";

export type QuoteResponse = {
  lines: PricedLine[];
  errors: LineError[];
  subtotalCents: number;
  currency: string;
  leadTimeHours: number;
  earliestDate: string | null;
  pickupAvailable: boolean;
  deliveryAvailable: boolean;
};

/** Re-price the browser's cart from the database. */
export async function quoteAction(raw: unknown): Promise<QuoteResponse> {
  const parsed = cartSchema.safeParse(raw);
  if (!parsed.success) {
    return { lines: [], errors: [{ productId: "", key: "", message: "Your cart couldn't be read and has been reset." }], subtotalCents: 0, currency: "usd", leadTimeHours: 0, earliestDate: null, pickupAvailable: false, deliveryAvailable: false };
  }
  const s = await getSettings();
  const q = await quoteCart(parsed.data, s);
  return { ...q, earliestDate: earliestDateFor(q, s) };
}

export type CheckoutState = { message?: string; fieldErrors?: Record<string, string>; lineErrors?: LineError[]; values?: Record<string, string> };

const ECHO_FIELDS = ["customerName", "customerEmail", "customerPhone", "fulfillmentDate", "line1", "line2", "city", "region", "postalCode", "notes"] as const;

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
    deliveryAddress: delivery
      ? { line1: form.get("line1"), line2: form.get("line2") ?? undefined, city: form.get("city"), region: form.get("region"), postalCode: form.get("postalCode") }
      : undefined,
    notes: form.get("notes") ?? undefined,
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

