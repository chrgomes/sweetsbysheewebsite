import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { loadPricedProducts } from "@/lib/catalog";
import { checkFulfillmentDate, earliestFulfillmentDate, formatDate, type FulfillmentRules } from "@/lib/dates";
import { env, siteUrl } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { orderConfirmationEmail, orderNotificationEmail } from "@/lib/email/templates";
import { log } from "@/lib/log";
import { taxFor } from "@/lib/money";
import { paymentProvider, type PaymentEvent } from "@/lib/payments";
import { isLineError, MAX_CART_LINES, normalizeCart, priceLine, type CartLineInput, type LineError, type PricedLine } from "@/lib/pricing";
import { checkoutReadiness, getSettings, type SiteSettings } from "@/lib/settings";
import { makeReference, randomToken, safeEqual, sha256 } from "@/lib/tokens";
import { addressSchema, emailSchema, nameSchema, optionalPhoneSchema, optionalText } from "@/lib/validation";

export const cartLineSchema = z.object({
  productId: z.uuid(),
  optionValueIds: z.array(z.uuid()).max(20),
  quantity: z.number().int().min(1).max(999),
});

export const cartSchema = z.array(cartLineSchema).max(MAX_CART_LINES);

export type Quote = {
  lines: PricedLine[];
  errors: LineError[];
  subtotalCents: number;
  currency: string;
  /** Strictest lead time among the lines (and the shop minimum). */
  leadTimeHours: number;
  pickupAvailable: boolean;
  deliveryAvailable: boolean;
};

export function fulfillmentRules(s: SiteSettings, leadTimeHours: number): FulfillmentRules {
  return {
    timeZone: s.timezone,
    leadTimeHours,
    maxAdvanceDays: s.maxAdvanceDays,
    weekdays: s.fulfillmentWeekdays,
    blackoutDates: s.blackoutDates,
  };
}

/** Price a cart from the database. Unknown, unavailable or invalid lines are returned as errors, never priced. */
export async function quoteCart(input: CartLineInput[], settings?: SiteSettings): Promise<Quote> {
  const s = settings ?? (await getSettings());
  const cart = normalizeCart(input);
  const products = await loadPricedProducts(cart.map((l) => l.productId));
  const lines: PricedLine[] = [];
  const errors: LineError[] = [];
  for (const l of cart) {
    const priced = priceLine(products.get(l.productId), l);
    if (isLineError(priced)) errors.push(priced);
    else lines.push(priced);
  }
  const leadTimeHours = Math.max(s.minLeadTimeHours, ...lines.map((l) => l.leadTimeHours ?? 0));
  return {
    lines,
    errors,
    subtotalCents: lines.reduce((sum, l) => sum + l.lineTotalCents, 0),
    currency: s.currency,
    leadTimeHours,
    pickupAvailable: s.pickupEnabled && lines.every((l) => l.pickupEligible),
    deliveryAvailable: s.deliveryEnabled && s.deliveryFeeCents !== null && lines.every((l) => l.deliveryEligible),
  };
}

export function earliestDateFor(quote: Quote, s: SiteSettings): string | null {
  return earliestFulfillmentDate(fulfillmentRules(s, quote.leadTimeHours));
}

export const checkoutSchema = z
  .object({
    cart: cartSchema.min(1, "Your cart is empty."),
    customerName: nameSchema,
    customerEmail: emailSchema,
    customerPhone: optionalPhoneSchema,
    fulfillmentMethod: z.enum(["pickup", "delivery"]),
    fulfillmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a date."),
    deliveryAddress: addressSchema.optional(),
    notes: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.fulfillmentMethod === "delivery" && !v.deliveryAddress) {
      ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Please enter a delivery address." });
    }
  });

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type PlaceOrderResult =
  | { ok: true; orderId: string; reference: string; redirectUrl: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string>; lineErrors?: LineError[] };

/**
 * Create a pending order from server-side prices and hand off to the payment
 * provider's hosted checkout. The order only becomes "paid" from a verified
 * payment webhook, never from the browser.
 */
export async function placeOrder(input: CheckoutInput): Promise<PlaceOrderResult> {
  const s = await getSettings();
  const provider = paymentProvider();
  const readiness = checkoutReadiness(s, provider !== null);
  if (!readiness.ready || !provider) {
    return { ok: false, message: "Online checkout isn't available right now. Please contact us to place your order." };
  }

  const quote = await quoteCart(input.cart, s);
  if (quote.errors.length) {
    return { ok: false, message: "Some items in your cart need attention.", lineErrors: quote.errors };
  }
  if (!quote.lines.length) return { ok: false, message: "Your cart is empty." };

  if (input.fulfillmentMethod === "pickup" && !quote.pickupAvailable) {
    return { ok: false, message: "Pickup isn't available for this order.", fieldErrors: { fulfillmentMethod: "Pickup isn't available for these items." } };
  }
  if (input.fulfillmentMethod === "delivery" && !quote.deliveryAvailable) {
    return { ok: false, message: "Delivery isn't available for this order.", fieldErrors: { fulfillmentMethod: "Delivery isn't available for these items." } };
  }
  const dateCheck = checkFulfillmentDate(input.fulfillmentDate, fulfillmentRules(s, quote.leadTimeHours));
  if (!dateCheck.ok) return { ok: false, message: dateCheck.reason, fieldErrors: { fulfillmentDate: dateCheck.reason } };

  const taxRateBps = s.taxRateBps!;
  const deliveryFeeCents = input.fulfillmentMethod === "delivery" ? s.deliveryFeeCents! : 0;
  // With Stripe automatic tax the provider computes tax; we record 0 until the webhook reports the total.
  const automaticTax = provider.name === "stripe" && env().STRIPE_AUTOMATIC_TAX;
  const taxCents = automaticTax ? 0 : taxFor(quote.subtotalCents + deliveryFeeCents, taxRateBps);
  const totalCents = quote.subtotalCents + deliveryFeeCents + taxCents;

  const accessToken = randomToken(24);
  const reference = makeReference("SBS");

  const order = await db().transaction(async (tx) => {
    const [o] = await tx
      .insert(schema.orders)
      .values({
        reference,
        status: "pending_payment",
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone ?? null,
        fulfillmentMethod: input.fulfillmentMethod,
        fulfillmentDate: input.fulfillmentDate,
        deliveryAddress: input.fulfillmentMethod === "delivery" ? input.deliveryAddress : null,
        notes: input.notes ?? null,
        subtotalCents: quote.subtotalCents,
        taxCents,
        deliveryFeeCents,
        totalCents,
        currency: quote.currency,
        taxRateBps,
        paymentProvider: provider.name,
        accessTokenHash: sha256(accessToken),
      })
      .returning();
    await tx.insert(schema.orderItems).values(
      quote.lines.map((l) => ({
        orderId: o.id,
        productId: l.productId,
        productName: l.name,
        options: l.options,
        unitPriceCents: l.unitPriceCents,
        quantity: l.quantity,
        lineTotalCents: l.lineTotalCents,
      })),
    );
    return o;
  });

  const statusUrl = siteUrl(`/order/${order.reference}?t=${accessToken}`);
  try {
    const session = await provider.createCheckout({
      orderId: order.id,
      reference: order.reference,
      currency: order.currency,
      customerEmail: order.customerEmail,
      lines: quote.lines.map((l) => ({
        name: l.name,
        description: l.options.map((o) => `${o.option}: ${o.value}`).join(", ") || undefined,
        unitAmountCents: l.unitPriceCents,
        quantity: l.quantity,
      })),
      taxCents,
      taxLabel: s.taxLabel,
      deliveryFeeCents,
      successUrl: statusUrl,
      cancelUrl: siteUrl(`/checkout?cancelled=${order.reference}`),
    });
    await db().update(schema.orders).set({ paymentSessionId: session.sessionId }).where(eq(schema.orders.id, order.id));
    log.info("order.created", { orderId: order.id, reference: order.reference, totalCents });
    return { ok: true, orderId: order.id, reference: order.reference, redirectUrl: session.url };
  } catch (err) {
    log.error("order.checkout_session_failed", { orderId: order.id, error: String(err) });
    await db().update(schema.orders).set({ status: "payment_failed", internalNotes: "Could not start checkout session." }).where(eq(schema.orders.id, order.id));
    return { ok: false, message: "We couldn't start the payment step. Please try again in a moment." };
  }
}

export type PaymentEventOutcome = "duplicate" | "ignored" | "unknown_order" | "paid" | "failed" | "expired" | "no_change";

/**
 * Apply a verified payment event exactly once. The event id is recorded in
 * the same transaction as the order update, so a redelivered or concurrent
 * duplicate webhook is a no-op.
 */
export async function handlePaymentEvent(evt: PaymentEvent): Promise<PaymentEventOutcome> {
  if (evt.type === "ignored" || !evt.sessionId) return "ignored";

  const result = await db().transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.paymentEvents)
      .values({ id: evt.id, provider: evt.provider, type: evt.type })
      .onConflictDoNothing()
      .returning({ id: schema.paymentEvents.id });
    if (!inserted.length) return { outcome: "duplicate" as const };

    const order = await tx.query.orders.findFirst({ where: eq(schema.orders.paymentSessionId, evt.sessionId!) });
    if (!order) return { outcome: "unknown_order" as const };
    await tx.update(schema.paymentEvents).set({ orderId: order.id }).where(eq(schema.paymentEvents.id, evt.id));

    if (evt.type === "paid") {
      const notes: string[] = [];
      let totalCents = order.totalCents;
      let taxCents = order.taxCents;
      if (evt.amountTotalCents !== null && evt.amountTotalCents !== order.totalCents) {
        if (order.paymentProvider === "stripe" && env().STRIPE_AUTOMATIC_TAX && evt.amountTotalCents >= order.totalCents) {
          taxCents = evt.amountTotalCents - order.subtotalCents - order.deliveryFeeCents;
          totalCents = evt.amountTotalCents;
        } else {
          notes.push(`Amount mismatch: provider reported ${evt.amountTotalCents}, order total ${order.totalCents}. Review before fulfilling.`);
        }
      }
      const updated = await tx
        .update(schema.orders)
        .set({
          status: "paid",
          paidAt: new Date(),
          paymentIntentId: evt.paymentIntentId,
          totalCents,
          taxCents,
          ...(notes.length ? { internalNotes: [order.internalNotes, ...notes].filter(Boolean).join("\n") } : {}),
        })
        .where(and(eq(schema.orders.id, order.id), inArray(schema.orders.status, ["pending_payment", "payment_failed"])))
        .returning({ id: schema.orders.id });
      if (notes.length) log.error("order.amount_mismatch", { orderId: order.id, reported: evt.amountTotalCents, expected: order.totalCents });
      return { outcome: updated.length ? ("paid" as const) : ("no_change" as const), orderId: order.id };
    }

    const status = evt.type === "failed" ? "payment_failed" : "cancelled";
    const updated = await tx
      .update(schema.orders)
      .set({ status })
      .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, "pending_payment")))
      .returning({ id: schema.orders.id });
    return { outcome: updated.length ? (evt.type as "failed" | "expired") : ("no_change" as const), orderId: order.id };
  });

  if (result.outcome === "paid" && "orderId" in result) {
    await audit(SYSTEM_ACTOR, "order.paid", "order", result.orderId!, { eventId: evt.id });
    await sendOrderEmails(result.orderId!);
  }
  log.info("payment.event", { eventId: evt.id, type: evt.type, outcome: result.outcome });
  return result.outcome;
}

async function sendOrderEmails(orderId: string) {
  const order = await db().query.orders.findFirst({ where: eq(schema.orders.id, orderId), with: { items: true } });
  if (!order || order.confirmationEmailSentAt) return;
  const s = await getSettings();
  const customer = await sendEmail(orderConfirmationEmail(order, s));
  const business = env().BUSINESS_NOTIFICATION_EMAIL ?? s.contactEmail;
  if (business) await sendEmail(orderNotificationEmail(order, business));
  if (customer.ok) {
    await db().update(schema.orders).set({ confirmationEmailSentAt: new Date() }).where(eq(schema.orders.id, orderId));
  }
}

/** Look up an order for the customer-facing status page; requires the token from their confirmation link. */
export async function getOrderForCustomer(reference: string, token: string | undefined) {
  if (!token || token.length > 100 || !/^SBS-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(reference)) return null;
  const order = await db().query.orders.findFirst({ where: eq(schema.orders.reference, reference), with: { items: true } });
  if (!order || !safeEqual(order.accessTokenHash, sha256(token))) return null;
  return order;
}

export const ORDER_STATUS_LABELS: Record<(typeof schema.orderStatus.enumValues)[number], string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid — confirmed",
  in_progress: "Being prepared",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
  payment_failed: "Payment failed",
  refunded: "Refunded",
};

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending_payment: ["cancelled"],
  payment_failed: ["cancelled"],
  paid: ["in_progress", "ready", "completed", "cancelled", "refunded"],
  in_progress: ["ready", "completed", "cancelled", "refunded"],
  ready: ["completed", "in_progress", "refunded"],
  completed: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function allowedNextStatuses(current: string): string[] {
  return ALLOWED_TRANSITIONS[current] ?? [];
}

/** Admin status change. Payment status ("paid") can only come from the payment provider. */
export async function updateOrderStatus(actor: Actor, orderId: string, next: string) {
  const order = await db().query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) return { ok: false as const, message: "Order not found." };
  if (!allowedNextStatuses(order.status).includes(next)) {
    return { ok: false as const, message: `Can't change an order from "${ORDER_STATUS_LABELS[order.status]}" to that status.` };
  }
  await db()
    .update(schema.orders)
    .set({ status: next as (typeof schema.orderStatus.enumValues)[number] })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, order.status)));
  await audit(actor, "order.status_changed", "order", orderId, { from: order.status, to: next });
  return { ok: true as const };
}

export function describeFulfillment(order: { fulfillmentMethod: string; fulfillmentDate: string }) {
  return `${order.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"} on ${formatDate(order.fulfillmentDate)}`;
}
