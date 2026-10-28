import "server-only";
import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type DbOrTx, type Tx } from "@/db";
import { audit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { claimCapacity, confirmCapacity, fullDates, releaseCapacity } from "@/lib/capacity";
import { loadPricedProducts } from "@/lib/catalog";
import { upsertCustomer } from "@/lib/customers";
import { addDays, checkFulfillmentDate, dateInZone, earliestFulfillmentDate, formatDate, type FulfillmentRules } from "@/lib/dates";
import { checkDiscount, confirmRedemption, reserveDiscount, voidRedemption } from "@/lib/discounts";
import { siteUrl } from "@/lib/env";
import { consumeStockForOrder, reverseStockForOrder } from "@/lib/inventory";
import { linkToken, orderLink, verifyLinkToken } from "@/lib/links";
import { log } from "@/lib/log";
import { businessRecipient, deliverNow, enqueue } from "@/lib/notifications";
import * as T from "@/lib/notifications/templates";
import { paymentProvider, providerByName, type PaymentEvent } from "@/lib/payments";
import type { CheckoutLine } from "@/lib/payments/types";
import {
  isLineError,
  MAX_CART_LINES,
  MAX_TEXT_OPTION_LENGTH,
  normalizeCart,
  orderTotals,
  priceLine,
  type CartLineInput,
  type LineError,
  type PricedLine,
} from "@/lib/pricing";
import { checkoutReadiness, getSettings, type SiteSettings } from "@/lib/settings";
import { makeReference, safeEqual, sha256 } from "@/lib/tokens";
import { addressSchema, emailSchema, nameSchema, optionalPhoneSchema, optionalText } from "@/lib/validation";

type Order = typeof schema.orders.$inferSelect;
export const ORDER_STATUSES = schema.orderStatus.enumValues;
export const PAYMENT_STATUSES = schema.orderPaymentStatus.enumValues;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Cart and quoting                                                    */
/* ------------------------------------------------------------------ */

export const cartLineSchema = z.object({
  productId: z.uuid(),
  optionValueIds: z.array(z.uuid()).max(20),
  texts: z
    .array(z.object({ optionId: z.uuid(), value: z.string().max(MAX_TEXT_OPTION_LENGTH * 2) }))
    .max(10)
    .optional(),
  quantity: z.number().int().min(1).max(999),
});

export const cartSchema = z.array(cartLineSchema).max(MAX_CART_LINES);

export type DiscountQuote = { code: string; amountCents: number } | { code: string; error: string };

export type Quote = {
  lines: PricedLine[];
  errors: LineError[];
  subtotalCents: number;
  discount: DiscountQuote | null;
  currency: string;
  /** Strictest lead time among the lines (and the shop minimum). */
  leadTimeHours: number;
  capacityUnits: number;
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
    cutoffTime: s.orderCutoffTime,
  };
}

/** Price a cart from the database. Unknown, unavailable or invalid lines are returned as errors, never priced. */
export async function quoteCart(input: CartLineInput[], settings?: SiteSettings, opts: { discountCode?: string | null; email?: string } = {}): Promise<Quote> {
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
  const subtotalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  let discount: DiscountQuote | null = null;
  if (opts.discountCode?.trim()) {
    const check = await checkDiscount(opts.discountCode, subtotalCents, { email: opts.email, currency: s.currency });
    discount = check.ok ? { code: check.discount.code, amountCents: check.amountCents } : { code: opts.discountCode.trim().toUpperCase(), error: check.message };
  }
  return {
    lines,
    errors,
    subtotalCents,
    discount,
    currency: s.currency,
    leadTimeHours: Math.max(s.minLeadTimeHours, ...lines.map((l) => l.leadTimeHours ?? 0)),
    capacityUnits: lines.reduce((sum, l) => sum + l.capacityUnits, 0),
    pickupAvailable: s.pickupEnabled && lines.every((l) => l.pickupEligible),
    deliveryAvailable: s.deliveryEnabled && s.deliveryFeeCents !== null && lines.every((l) => l.deliveryEligible),
  };
}

/** Earliest bookable date for a quote, skipping fully booked days. */
export async function earliestDateFor(quote: Pick<Quote, "leadTimeHours" | "capacityUnits">, s: SiteSettings): Promise<{ earliest: string | null; full: string[] }> {
  const rules = fulfillmentRules(s, quote.leadTimeHours);
  const today = dateInZone(new Date(), s.timezone);
  const until = addDays(today, s.maxAdvanceDays);
  const full = s.dailyCapacityUnits === null ? new Set<string>() : await fullDates(today, until, Math.max(1, quote.capacityUnits), s);
  const blocked = { ...rules, blackoutDates: [...rules.blackoutDates, ...full] };
  return { earliest: earliestFulfillmentDate(blocked), full: [...full].sort().slice(0, 14) };
}

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

export const checkoutSchema = z
  .object({
    cart: cartSchema.min(1, "Your cart is empty."),
    customerName: nameSchema,
    customerEmail: emailSchema,
    customerPhone: optionalPhoneSchema,
    fulfillmentMethod: z.enum(["pickup", "delivery"]),
    fulfillmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a date."),
    fulfillmentWindow: optionalText(40),
    deliveryAddress: addressSchema.optional(),
    notes: optionalText(1000),
    discountCode: optionalText(40),
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
 * Create a pending order from server-side prices, hold its capacity, and hand
 * off to the payment provider's hosted checkout. The order is confirmed only
 * by a verified payment event, never by the browser.
 */
export async function placeOrder(input: CheckoutInput): Promise<PlaceOrderResult> {
  const s = await getSettings();
  const provider = paymentProvider();
  if (!checkoutReadiness(s, provider !== null).ready || !provider) {
    return { ok: false, message: "Online checkout isn't available right now. Please contact us to place your order." };
  }

  const quote = await quoteCart(input.cart, s);
  if (quote.errors.length) return { ok: false, message: "Some items in your cart need attention.", lineErrors: quote.errors };
  if (!quote.lines.length) return { ok: false, message: "Your cart is empty." };

  if (input.fulfillmentMethod === "pickup" && !quote.pickupAvailable) {
    return { ok: false, message: "Pickup isn't available for this order.", fieldErrors: { fulfillmentMethod: "Pickup isn't available for these items." } };
  }
  if (input.fulfillmentMethod === "delivery" && !quote.deliveryAvailable) {
    return { ok: false, message: "Delivery isn't available for this order.", fieldErrors: { fulfillmentMethod: "Delivery isn't available for these items." } };
  }
  if (s.fulfillmentWindows.length) {
    if (!input.fulfillmentWindow || !s.fulfillmentWindows.includes(input.fulfillmentWindow)) {
      return { ok: false, message: "Please choose a time.", fieldErrors: { fulfillmentWindow: "Please choose a time." } };
    }
  }
  const dateCheck = checkFulfillmentDate(input.fulfillmentDate, fulfillmentRules(s, quote.leadTimeHours));
  if (!dateCheck.ok) return { ok: false, message: dateCheck.reason, fieldErrors: { fulfillmentDate: dateCheck.reason } };

  const deliveryFeeCents = input.fulfillmentMethod === "delivery" ? s.deliveryFeeCents! : 0;
  const reference = makeReference("SBS");

  type TxResult = { ok: true; order: Order; paymentId: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };
  let result: TxResult;
  try {
    result = await db().transaction(async (tx): Promise<TxResult> => {
      const customerId = await upsertCustomer(tx, { email: input.customerEmail, name: input.customerName, phone: input.customerPhone });
      const placeholder = orderTotals({ subtotalCents: quote.subtotalCents, deliveryFeeCents, taxRateBps: s.taxRateBps! });
      const [order] = await tx
        .insert(schema.orders)
        .values({
          reference,
          customerId,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone ?? null,
          fulfillmentMethod: input.fulfillmentMethod,
          fulfillmentDate: input.fulfillmentDate,
          fulfillmentWindow: input.fulfillmentWindow ?? null,
          deliveryAddress: input.fulfillmentMethod === "delivery" ? input.deliveryAddress : null,
          notes: input.notes ?? null,
          subtotalCents: quote.subtotalCents,
          taxCents: placeholder.taxCents,
          deliveryFeeCents,
          totalCents: placeholder.totalCents,
          currency: quote.currency,
          taxRateBps: s.taxRateBps!,
          accessTokenHash: "pending",
        })
        .returning();

      let discountCents = 0;
      let discountCode: string | null = null;
      if (input.discountCode) {
        const d = await reserveDiscount(tx, { code: input.discountCode, subtotalCents: quote.subtotalCents, email: input.customerEmail, orderId: order.id, currency: quote.currency });
        if (!d.ok) throw new Rollback({ ok: false, message: d.message, fieldErrors: { discountCode: d.message } });
        discountCents = d.amountCents;
        discountCode = d.discount.code;
      }
      const totals = orderTotals({ subtotalCents: quote.subtotalCents, discountCents, deliveryFeeCents, taxRateBps: s.taxRateBps! });

      const claim = await claimCapacity(tx, s, { date: input.fulfillmentDate, units: quote.capacityUnits, orderId: order.id, hold: true });
      if (!claim.ok) throw new Rollback({ ok: false, message: claim.reason, fieldErrors: { fulfillmentDate: claim.reason } });

      const [updated] = await tx
        .update(schema.orders)
        .set({ discountCents: totals.discountCents, discountCode, taxCents: totals.taxCents, totalCents: totals.totalCents, accessTokenHash: sha256(linkToken("order", order.id)) })
        .where(eq(schema.orders.id, order.id))
        .returning();
      await tx.insert(schema.orderItems).values(
        quote.lines.map((l) => ({
          orderId: order.id,
          productId: l.productId,
          productName: l.name,
          options: l.options,
          unitPriceCents: l.unitPriceCents,
          quantity: l.quantity,
          lineTotalCents: l.lineTotalCents,
        })),
      );
      const [payment] = await tx
        .insert(schema.payments)
        .values({ orderId: order.id, kind: "full", amountCents: totals.totalCents, currency: quote.currency, provider: provider.name })
        .returning({ id: schema.payments.id });
      return { ok: true, order: updated, paymentId: payment.id };
    });
  } catch (err) {
    if (err instanceof Rollback) result = err.result as TxResult;
    else throw err;
  }
  if (!result.ok) return result;

  const { order, paymentId } = result;
  const lines: CheckoutLine[] =
    order.discountCents > 0
      ? [{ name: `${s.businessName} order ${order.reference}`, description: summarise(quote.lines, order), unitAmountCents: order.totalCents, quantity: 1 }]
      : [
          ...quote.lines.map((l) => ({ name: l.name, description: l.options.map((o) => `${o.option}: ${o.value}`).join(", ") || undefined, unitAmountCents: l.unitPriceCents, quantity: l.quantity })),
          ...(order.deliveryFeeCents ? [{ name: "Delivery", unitAmountCents: order.deliveryFeeCents, quantity: 1 }] : []),
          ...(order.taxCents ? [{ name: s.taxLabel, unitAmountCents: order.taxCents, quantity: 1 }] : []),
        ];
  const started = await startCheckout(order, paymentId, lines, siteUrl(`/checkout?cancelled=${order.reference}`));
  if (!started.ok) {
    await abandonOrder(order.id, "Could not start the payment step.");
    return { ok: false, message: "We couldn't start the payment step. Please try again in a moment." };
  }
  log.info("order.created", { orderId: order.id, reference: order.reference, totalCents: order.totalCents });
  return { ok: true, orderId: order.id, reference: order.reference, redirectUrl: started.url };
}

/** Thrown inside a transaction to roll it back with a user-facing result. */
class Rollback extends Error {
  constructor(public result: unknown) {
    super("rollback");
  }
}

function summarise(lines: PricedLine[], order: Order) {
  return [
    ...lines.map((l) => `${l.quantity} × ${l.name}`),
    order.discountCode ? `discount ${order.discountCode}` : "",
    order.deliveryFeeCents ? "delivery" : "",
    "tax included",
  ]
    .filter(Boolean)
    .join(", ");
}

/** Create a hosted checkout session for a payment record and store its id. */
async function startCheckout(order: Order, paymentId: string, lines: CheckoutLine[], cancelUrl: string): Promise<{ ok: true; url: string } | { ok: false }> {
  const provider = paymentProvider();
  if (!provider) return { ok: false };
  try {
    const session = await provider.createCheckout({
      paymentId,
      orderId: order.id,
      reference: order.reference,
      currency: order.currency,
      customerEmail: order.customerEmail,
      lines,
      successUrl: orderLink(order),
      cancelUrl,
    });
    await db().update(schema.payments).set({ providerSessionId: session.sessionId }).where(eq(schema.payments.id, paymentId));
    return { ok: true, url: session.url };
  } catch (err) {
    log.error("payment.session_failed", { orderId: order.id, paymentId, error: String(err) });
    await db().update(schema.payments).set({ status: "failed", note: "Could not start checkout session." }).where(eq(schema.payments.id, paymentId));
    return { ok: false };
  }
}

/** Cancel an unpaid order and free what it held. */
async function abandonOrder(orderId: string, reason: string) {
  await db().transaction(async (tx) => {
    await tx
      .update(schema.orders)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason })
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, "pending")));
    await releaseCapacity(tx, orderId);
    await voidRedemption(tx, orderId);
  });
}

/* ------------------------------------------------------------------ */
/* Payment state                                                       */
/* ------------------------------------------------------------------ */

/** What's still owed: the deposit (if not yet met) or the rest of the total. */
export function amountDue(o: Pick<Order, "totalCents" | "depositCents" | "amountPaidCents">, kind: "deposit" | "balance" | "full"): number {
  if (kind === "deposit") return Math.max(0, o.depositCents - o.amountPaidCents);
  return Math.max(0, o.totalCents - o.amountPaidCents);
}

/** Recompute an order's paid/refunded totals and payment status from the ledger. */
export async function recomputePayments(tx: DbOrTx, orderId: string): Promise<Order> {
  const order = (await tx.query.orders.findFirst({ where: eq(schema.orders.id, orderId) }))!;
  const pays = await tx.query.payments.findMany({ where: eq(schema.payments.orderId, orderId), orderBy: [desc(schema.payments.createdAt)] });
  const paid = pays.filter((p) => p.status === "succeeded").reduce((n, p) => n + p.amountCents, 0);
  const refunded = pays.reduce((n, p) => n + p.refundedCents, 0);
  let status: PaymentStatus;
  if (refunded > 0 && refunded >= paid) status = "refunded";
  else if (refunded > 0) status = "partially_refunded";
  else if (paid >= order.totalCents && paid > 0) status = "paid";
  else if (paid > 0) status = "deposit_paid";
  else if (pays[0]?.status === "failed") status = "failed";
  else status = "unpaid";
  const [updated] = await tx
    .update(schema.orders)
    .set({ amountPaidCents: paid, amountRefundedCents: refunded, paymentStatus: status })
    .where(eq(schema.orders.id, orderId))
    .returning();
  return updated;
}

/** Enough has been paid to confirm the order: the deposit when one applies, otherwise the full total. */
function confirmable(o: Order) {
  return o.amountPaidCents >= (o.depositCents > 0 ? o.depositCents : o.totalCents);
}

async function withItems(tx: DbOrTx, orderId: string) {
  return (await tx.query.orders.findFirst({ where: eq(schema.orders.id, orderId), with: { items: true } }))!;
}

/**
 * Confirm a pending order once enough has been paid: confirm its capacity and
 * discount, update a linked custom request, and queue confirmation emails.
 * Returns notification ids to deliver after commit.
 */
async function confirmIfPaid(tx: Tx, s: SiteSettings, order: Order): Promise<(string | null)[]> {
  if (order.status !== "pending" || !confirmable(order)) return [];
  const [confirmed] = await tx
    .update(schema.orders)
    .set({ status: "confirmed" })
    .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, "pending")))
    .returning();
  if (!confirmed) return [];
  const units = (await tx.query.capacityReservations.findFirst({ where: eq(schema.capacityReservations.orderId, order.id) }))?.units ?? 1;
  await confirmCapacity(tx, s, confirmed, units);
  await confirmRedemption(tx, order.id);
  if (confirmed.sourceInquiryId) {
    await tx.update(schema.inquiries).set({ status: "confirmed" }).where(eq(schema.inquiries.id, confirmed.sourceInquiryId));
  }
  const full = await withItems(tx, order.id);
  const ids = [
    await enqueue(tx, { kind: "order.confirmed", dedupeKey: `order:${order.id}:confirmed`, to: full.customerEmail, email: T.orderConfirmed(full, s, orderLink(full)), replyTo: s.contactEmail, related: { type: "order", id: order.id } }),
  ];
  const biz = businessRecipient(s);
  if (biz) {
    ids.push(await enqueue(tx, { kind: "order.new_business", dedupeKey: `order:${order.id}:business`, to: biz, email: T.newOrderForBusiness(full, s, siteUrl(`/admin/orders/${order.id}`)), replyTo: full.customerEmail, related: { type: "order", id: order.id } }));
  }
  await audit(SYSTEM_ACTOR, "order.confirmed", "order", order.id, { paymentStatus: full.paymentStatus, amountPaidCents: full.amountPaidCents });
  return ids;
}

export type PaymentEventOutcome = "duplicate" | "ignored" | "retry_later" | "paid" | "failed" | "expired" | "refund_succeeded" | "refund_failed" | "no_change";

/**
 * Apply a verified payment event exactly once. The event id is recorded in
 * the same transaction as its effects, so redelivered or concurrent duplicates
 * are no-ops. Every update is conditional on the current state, so events
 * arriving out of order (e.g. "expired" after "paid") can't undo progress.
 * Events we can't match yet return "retry_later" without being recorded, so
 * the provider redelivers them.
 */
export async function handlePaymentEvent(evt: PaymentEvent): Promise<PaymentEventOutcome> {
  if (evt.type === "ignored") return "ignored";
  const s = await getSettings();
  let toDeliver: (string | null)[] = [];

  const outcome = await db().transaction(async (tx): Promise<PaymentEventOutcome> => {
    const inserted = await tx
      .insert(schema.paymentEvents)
      .values({ id: evt.id, provider: evt.provider, type: evt.type })
      .onConflictDoNothing()
      .returning({ id: schema.paymentEvents.id });
    if (!inserted.length) return "duplicate";

    if (evt.type === "refund_succeeded" || evt.type === "refund_failed") {
      const refund = evt.refundId ? await tx.query.refunds.findFirst({ where: eq(schema.refunds.providerRefundId, evt.refundId) }) : undefined;
      if (!refund) throw new RetryLater();
      await tx.update(schema.paymentEvents).set({ orderId: refund.orderId }).where(eq(schema.paymentEvents.id, evt.id));
      const res = await settleRefund(tx, s, refund.id, evt.type === "refund_succeeded" ? "succeeded" : "failed", evt.failureReason ?? null);
      toDeliver = res.ids;
      return res.changed ? evt.type : "no_change";
    }

    const payment = evt.sessionId ? await tx.query.payments.findFirst({ where: eq(schema.payments.providerSessionId, evt.sessionId) }) : undefined;
    if (!payment) throw new RetryLater();
    await tx.update(schema.paymentEvents).set({ orderId: payment.orderId }).where(eq(schema.paymentEvents.id, evt.id));

    if (evt.type === "paid") {
      const notes: string[] = [];
      if (evt.amountTotalCents !== null && evt.amountTotalCents !== payment.amountCents) {
        notes.push(`Amount mismatch on payment ${payment.id}: provider reported ${evt.amountTotalCents}, expected ${payment.amountCents}. Review before fulfilling.`);
        log.error("payment.amount_mismatch", { paymentId: payment.id, reported: evt.amountTotalCents, expected: payment.amountCents });
      }
      const updated = await tx
        .update(schema.payments)
        .set({ status: "succeeded", succeededAt: new Date(), providerPaymentId: evt.paymentIntentId, amountCents: evt.amountTotalCents ?? payment.amountCents })
        .where(and(eq(schema.payments.id, payment.id), inArray(schema.payments.status, ["pending", "expired", "failed"])))
        .returning({ id: schema.payments.id });
      if (!updated.length) return "no_change";
      if (notes.length) {
        const o = await tx.query.orders.findFirst({ where: eq(schema.orders.id, payment.orderId), columns: { internalNotes: true } });
        await tx.update(schema.orders).set({ internalNotes: [o?.internalNotes, ...notes].filter(Boolean).join("\n") }).where(eq(schema.orders.id, payment.orderId));
      }
      const order = await recomputePayments(tx, payment.orderId);
      await audit(SYSTEM_ACTOR, "payment.succeeded", "order", order.id, { paymentId: payment.id, kind: payment.kind, amountCents: evt.amountTotalCents, eventId: evt.id });
      toDeliver = await confirmIfPaid(tx, s, order);
      if (!toDeliver.length && order.status !== "pending") {
        // A deposit or balance on an already-confirmed order: send a receipt.
        const full = await withItems(tx, order.id);
        toDeliver.push(
          await enqueue(tx, { kind: "payment.received", dedupeKey: `payment:${payment.id}:received`, to: full.customerEmail, email: T.orderConfirmed(full, s, orderLink(full)), related: { type: "order", id: order.id } }),
        );
      }
      return "paid";
    }

    // failed / expired: only a still-pending payment changes.
    const newStatus = evt.type === "failed" ? "failed" : "expired";
    const changed = await tx
      .update(schema.payments)
      .set({ status: newStatus })
      .where(and(eq(schema.payments.id, payment.id), eq(schema.payments.status, "pending")))
      .returning({ id: schema.payments.id });
    if (!changed.length) return "no_change";
    const order = await recomputePayments(tx, payment.orderId);
    if (payment.kind === "full" && order.status === "pending" && order.amountPaidCents === 0) {
      // An online-shop checkout that won't complete: free its date and discount.
      await tx.update(schema.orders).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: evt.type === "failed" ? "Payment failed." : "Checkout expired." }).where(eq(schema.orders.id, order.id));
      await releaseCapacity(tx, order.id);
      await voidRedemption(tx, order.id);
    }
    if (evt.type === "failed") {
      const full = await withItems(tx, order.id);
      toDeliver = [await enqueue(tx, { kind: "payment.failed", dedupeKey: `payment:${payment.id}:failed`, to: full.customerEmail, email: T.paymentFailed(full, s, orderLink(full)), related: { type: "order", id: order.id } })];
    }
    return evt.type;
  }).catch((err) => {
    if (err instanceof RetryLater) return "retry_later" as const;
    throw err;
  });

  await deliverNow(toDeliver);
  log.info("payment.event", { eventId: evt.id, type: evt.type, outcome });
  return outcome;
}

class RetryLater extends Error {}

/* ------------------------------------------------------------------ */
/* Payment links, offline payments and refunds                         */
/* ------------------------------------------------------------------ */

/**
 * Start a hosted checkout for what's owed on an order (deposit first if one
 * applies and hasn't been met, otherwise the balance). Used by the customer's
 * order page and by staff sending a payment link.
 */
export async function startOrderPayment(orderId: string): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const provider = paymentProvider();
  if (!provider) return { ok: false, message: "Online payment isn't available. Please contact us to arrange payment." };
  const order = await db().query.orders.findFirst({ where: eq(schema.orders.id, orderId), with: { items: true } });
  if (!order || order.status === "cancelled" || order.status === "completed") return { ok: false, message: "This order can't take a payment." };
  const kind: "deposit" | "balance" | "full" = order.depositCents > 0 && order.amountPaidCents < order.depositCents ? "deposit" : order.amountPaidCents > 0 ? "balance" : "full";
  const amount = amountDue(order, kind);
  if (amount <= 0) return { ok: false, message: "Nothing is owed on this order." };
  const [payment] = await db()
    .insert(schema.payments)
    .values({ orderId: order.id, kind, amountCents: amount, currency: order.currency, provider: provider.name })
    .returning({ id: schema.payments.id });
  if (order.status === "pending" && kind !== "balance") {
    // Re-hold the date while the customer pays (it may have lapsed).
    const units = (await db().query.capacityReservations.findFirst({ where: eq(schema.capacityReservations.orderId, order.id) }))?.units ?? 1;
    const s = await getSettings();
    const held = await db().transaction((tx) => claimCapacity(tx, s, { date: order.fulfillmentDate, units, orderId: order.id, hold: true }));
    if (!held.ok) {
      await db().update(schema.payments).set({ status: "expired", note: "Date fully booked when payment was attempted." }).where(eq(schema.payments.id, payment.id));
      return { ok: false, message: "That date has filled up since your quote. Please contact us and we'll find a solution." };
    }
  }
  const label = kind === "deposit" ? "Deposit" : kind === "balance" ? "Remaining balance" : "Payment";
  const started = await startCheckout(order, payment.id, [{ name: `${label} — order ${order.reference}`, description: order.items.map((i) => `${i.quantity} × ${i.productName}`).join(", "), unitAmountCents: amount, quantity: 1 }], orderLink(order));
  return started.ok ? started : { ok: false, message: "We couldn't start the payment step. Please try again in a moment." };
}

export const offlinePaymentSchema = z.object({
  amountCents: z.number().int().positive("Enter the amount received."),
  method: z.string().trim().min(1, "Say how it was paid (cash, bank transfer…).").max(60),
  note: z.string().trim().min(1, "Add a note explaining the payment.").max(500),
});

/** Record money received outside the payment provider (cash, transfer). Audited with a reason. */
export async function recordOfflinePayment(actor: Actor, orderId: string, input: z.infer<typeof offlinePaymentSchema>) {
  const s = await getSettings();
  const order = await db().query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) return { ok: false as const, message: "Order not found." };
  if (order.status === "cancelled") return { ok: false as const, message: "Can't record a payment on a cancelled order." };
  if (input.amountCents > amountDue(order, "full")) return { ok: false as const, message: "That's more than is owed on this order." };
  let ids: (string | null)[] = [];
  await db().transaction(async (tx) => {
    const [p] = await tx
      .insert(schema.payments)
      .values({ orderId, kind: "offline", status: "succeeded", amountCents: input.amountCents, currency: order.currency, provider: "offline", method: input.method, note: input.note, recordedBy: actor.id, succeededAt: new Date() })
      .returning({ id: schema.payments.id });
    const updated = await recomputePayments(tx, orderId);
    ids = await confirmIfPaid(tx, s, updated);
    await audit(actor, "payment.offline_recorded", "order", orderId, { paymentId: p.id, amountCents: input.amountCents, method: input.method, note: input.note });
  });
  await deliverNow(ids);
  return { ok: true as const };
}

/** Amount of a payment that can still be refunded (excluding refunds in flight). */
async function refundable(tx: DbOrTx, paymentId: string) {
  const p = await tx.query.payments.findFirst({ where: eq(schema.payments.id, paymentId), with: { refunds: true } });
  if (!p) return null;
  const inFlight = p.refunds.filter((r) => r.status === "pending").reduce((n, r) => n + r.amountCents, 0);
  return { payment: p, available: p.status === "succeeded" ? p.amountCents - p.refundedCents - inFlight : 0 };
}

/**
 * Refund part or all of a payment. Provider payments are refunded through the
 * provider (idempotency key = our refund id); offline payments record a manual
 * refund. Totals update when the refund succeeds.
 */
export async function refundPayment(actor: Actor, paymentId: string, amountCents: number, reason: string) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false as const, message: "Enter a refund amount." };
  if (!reason.trim()) return { ok: false as const, message: "Give a reason for the refund." };
  const s = await getSettings();
  const r = await refundable(db(), paymentId);
  if (!r) return { ok: false as const, message: "Payment not found." };
  if (amountCents > r.available) return { ok: false as const, message: `At most ${(r.available / 100).toFixed(2)} can be refunded from this payment.` };

  const [refund] = await db().insert(schema.refunds).values({ paymentId, orderId: r.payment.orderId, amountCents, reason: reason.trim(), createdBy: actor.id }).returning();
  await audit(actor, "refund.requested", "order", r.payment.orderId, { refundId: refund.id, paymentId, amountCents, reason });

  let status: "pending" | "succeeded" | "failed" = "succeeded";
  let failureReason: string | null = null;
  if (r.payment.provider !== "offline") {
    const provider = providerByName(r.payment.provider);
    if (!provider || !r.payment.providerPaymentId) {
      await db().update(schema.refunds).set({ status: "failed", failureReason: "Payment provider unavailable." }).where(eq(schema.refunds.id, refund.id));
      return { ok: false as const, message: "This payment's provider isn't configured, so it can't be refunded from here." };
    }
    try {
      const res = await provider.refund({ providerPaymentId: r.payment.providerPaymentId, amountCents, idempotencyKey: refund.id });
      await db().update(schema.refunds).set({ providerRefundId: res.refundId }).where(eq(schema.refunds.id, refund.id));
      status = res.status;
      failureReason = res.failureReason ?? null;
    } catch (err) {
      log.error("refund.provider_failed", { refundId: refund.id, error: String(err) });
      status = "failed";
      failureReason = "The payment provider rejected the refund.";
    }
  }
  if (status !== "pending") {
    const res = await db().transaction((tx) => settleRefund(tx, s, refund.id, status as "succeeded" | "failed", failureReason));
    await deliverNow(res.ids);
  }
  if (status === "failed") return { ok: false as const, message: failureReason ?? "The refund failed." };
  return { ok: true as const, pending: status === "pending" };
}

/** Apply a refund's final state once (from the API response or a webhook, whichever is first). */
async function settleRefund(tx: Tx, s: SiteSettings, refundId: string, status: "succeeded" | "failed", failureReason: string | null) {
  const [refund] = await tx
    .update(schema.refunds)
    .set({ status, completedAt: new Date(), failureReason })
    .where(and(eq(schema.refunds.id, refundId), eq(schema.refunds.status, "pending")))
    .returning();
  if (!refund) return { changed: false, ids: [] as (string | null)[] };
  if (status === "failed") {
    await audit(SYSTEM_ACTOR, "refund.failed", "order", refund.orderId, { refundId, failureReason });
    return { changed: true, ids: [] };
  }
  const payment = (await tx.query.payments.findFirst({ where: eq(schema.payments.id, refund.paymentId) }))!;
  await tx.update(schema.payments).set({ refundedCents: payment.refundedCents + refund.amountCents }).where(eq(schema.payments.id, payment.id));
  await recomputePayments(tx, refund.orderId);
  const full = await withItems(tx, refund.orderId);
  await audit(SYSTEM_ACTOR, "refund.succeeded", "order", refund.orderId, { refundId, amountCents: refund.amountCents });
  const id = await enqueue(tx, { kind: "refund.issued", dedupeKey: `refund:${refund.id}:succeeded`, to: full.customerEmail, email: T.refundIssued(full, refund.amountCents, s, orderLink(full)), related: { type: "order", id: full.id } });
  return { changed: true, ids: [id] };
}

/* ------------------------------------------------------------------ */
/* Order status                                                        */
/* ------------------------------------------------------------------ */

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Awaiting payment",
  confirmed: "Confirmed",
  in_production: "In production",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
  on_hold: "On hold",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  deposit_paid: "Deposit paid",
  paid: "Paid",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  failed: "Payment failed",
};

export function statusLabel(o: Pick<Order, "status" | "fulfillmentMethod">) {
  if (o.status === "ready") return o.fulfillmentMethod === "pickup" ? "Ready for pickup" : "Ready for delivery";
  return ORDER_STATUS_LABELS[o.status];
}

/**
 * Allowed manual transitions. "pending → confirmed" is deliberately absent:
 * only a recorded payment can confirm an order.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["cancelled"],
  confirmed: ["in_production", "on_hold", "cancelled"],
  in_production: ["ready", "on_hold", "cancelled"],
  ready: ["completed", "on_hold", "cancelled"],
  on_hold: ["cancelled"], // plus "resume" to the status it was held from
  completed: [],
  cancelled: [],
};

/** Production staff may only move orders forward through production. */
const PROGRESS = new Set(["confirmed>in_production", "in_production>ready", "ready>completed"]);

export function allowedNextStatuses(o: Pick<Order, "status" | "onHoldFrom">): OrderStatus[] {
  const next = [...TRANSITIONS[o.status]];
  if (o.status === "on_hold" && o.onHoldFrom) next.unshift(o.onHoldFrom as OrderStatus);
  return next;
}

/** The permission a transition needs: moving forward in production, or managing the order. */
export function transitionPermission(from: OrderStatus, to: OrderStatus): "orders:progress" | "orders:manage" {
  return PROGRESS.has(`${from}>${to}`) ? "orders:progress" : "orders:manage";
}

export type StatusChange = { reason?: string | null; notify?: boolean };

/** Validated status change with side effects (capacity, discounts, emails, linked request). */
export async function updateOrderStatus(actor: Actor, orderId: string, next: OrderStatus, opts: StatusChange = {}) {
  const s = await getSettings();
  const order = await db().query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) return { ok: false as const, message: "Order not found." };
  if (!allowedNextStatuses(order).includes(next)) {
    return { ok: false as const, message: `Can't change an order from "${ORDER_STATUS_LABELS[order.status]}" to "${ORDER_STATUS_LABELS[next]}".` };
  }
  if (next === "completed" && order.amountPaidCents < order.totalCents) {
    return { ok: false as const, message: "Record the remaining balance before completing this order." };
  }
  if ((next === "cancelled" || next === "on_hold") && !opts.reason?.trim()) {
    return { ok: false as const, message: `Give a reason for ${next === "cancelled" ? "cancelling" : "holding"} the order.` };
  }
  let ids: (string | null)[] = [];
  await db().transaction(async (tx) => {
    const patch: Partial<typeof schema.orders.$inferInsert> = { status: next };
    if (next === "on_hold") patch.onHoldFrom = order.status;
    if (order.status === "on_hold") patch.onHoldFrom = null;
    if (next === "cancelled") Object.assign(patch, { cancelledAt: new Date(), cancelReason: opts.reason?.trim() ?? null });
    const [updated] = await tx
      .update(schema.orders)
      .set(patch)
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, order.status)))
      .returning();
    if (!updated) throw new Error("Order changed while updating; please retry.");
    if (next === "cancelled") {
      await releaseCapacity(tx, orderId);
      await voidRedemption(tx, orderId);
      await reverseStockForOrder(tx, orderId);
    }
    if (next === "in_production") await consumeStockForOrder(tx, orderId);
    if (updated.sourceInquiryId && (next === "completed" || next === "cancelled")) {
      await tx.update(schema.inquiries).set({ status: next }).where(eq(schema.inquiries.id, updated.sourceInquiryId));
    }
    const full = await withItems(tx, orderId);
    const notify = opts.notify ?? true;
    if (notify && next === "cancelled") {
      ids.push(await enqueue(tx, { kind: "order.cancelled", dedupeKey: `order:${orderId}:cancelled`, to: full.customerEmail, email: T.orderCancelled(full, s, orderLink(full), opts.reason ?? null), related: { type: "order", id: orderId } }));
    } else if (notify && s.notifyStatusChanges) {
      const email = T.orderStatusUpdate(full, next, s, orderLink(full));
      if (email) ids.push(await enqueue(tx, { kind: `order.${next}`, dedupeKey: `order:${orderId}:status:${next}`, to: full.customerEmail, email, related: { type: "order", id: orderId } }));
    }
    await audit(actor, "order.status_changed", "order", orderId, { from: order.status, to: next, reason: opts.reason ?? undefined, notified: ids.length > 0 });
  });
  ids = ids.filter(Boolean);
  await deliverNow(ids);
  return { ok: true as const, notified: ids.length > 0 };
}

/* ------------------------------------------------------------------ */
/* Customer access                                                     */
/* ------------------------------------------------------------------ */

/** Look up an order for the customer-facing page; requires the token from their link. */
export async function getOrderForCustomer(reference: string, token: string | undefined) {
  if (!token || token.length > 100 || !/^SBS-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(reference)) return null;
  const order = await db().query.orders.findFirst({ where: eq(schema.orders.reference, reference), with: { items: true, payments: true } });
  if (!order) return null;
  // Current links are derived from the id; older links matched a stored hash.
  const ok = verifyLinkToken("order", order.id, token) || safeEqual(order.accessTokenHash, sha256(token));
  return ok ? order : null;
}

export function describeFulfillment(order: { fulfillmentMethod: string; fulfillmentDate: string; fulfillmentWindow?: string | null }) {
  return `${order.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"} on ${formatDate(order.fulfillmentDate)}${order.fulfillmentWindow ? `, ${order.fulfillmentWindow}` : ""}`;
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

/**
 * Recover from missed webhooks: ask the provider about checkouts still
 * pending after 15 minutes and apply what it reports. Sessions older than two
 * hours that the provider can't resolve are treated as expired.
 */
export async function reconcilePendingPayments(): Promise<{ recovered: number; expired: number }> {
  const stale = await db().query.payments.findMany({
    where: and(eq(schema.payments.status, "pending"), ne(schema.payments.provider, "offline"), lt(schema.payments.createdAt, new Date(Date.now() - 15 * 60_000))),
    limit: 50,
  });
  let recovered = 0;
  let expired = 0;
  for (const p of stale) {
    const provider = providerByName(p.provider);
    let evt: PaymentEvent | null = null;
    if (provider && p.providerSessionId) {
      try {
        evt = await provider.recoverSession(p.providerSessionId);
      } catch (err) {
        log.warn("payment.recover_failed", { paymentId: p.id, error: String(err) });
        continue;
      }
    }
    if (evt) {
      if ((await handlePaymentEvent(evt)) === "paid") recovered++;
      else expired++;
    } else if (p.createdAt < new Date(Date.now() - 2 * 3_600_000)) {
      const outcome = await handlePaymentEvent({ id: `reconcile:${p.id}:expired`, provider: (p.provider === "stripe" ? "stripe" : "fake") as "stripe" | "fake", type: "expired", sessionId: p.providerSessionId, paymentIntentId: null, amountTotalCents: null, currency: null });
      if (outcome === "expired") expired++;
      if (!p.providerSessionId) await db().update(schema.payments).set({ status: "expired" }).where(and(eq(schema.payments.id, p.id), eq(schema.payments.status, "pending")));
    }
  }
  return { recovered, expired };
}

/** Email balance reminders for deposit-paid orders whose balance is now due (once per order). */
export async function sendBalanceReminders(): Promise<number> {
  const s = await getSettings();
  const dueBy = addDays(dateInZone(new Date(), s.timezone), s.balanceDueDaysBefore);
  const orders = await db().query.orders.findMany({
    where: and(eq(schema.orders.paymentStatus, "deposit_paid"), inArray(schema.orders.status, ["confirmed", "in_production", "ready"])),
    with: { items: true },
  });
  let n = 0;
  for (const o of orders.filter((x) => x.fulfillmentDate <= dueBy)) {
    const id = await enqueue(db(), { kind: "order.balance_reminder", dedupeKey: `order:${o.id}:balance_reminder`, to: o.customerEmail, email: T.balanceReminder(o, s, orderLink(o)), related: { type: "order", id: o.id } });
    if (id) n++;
  }
  return n;
}
