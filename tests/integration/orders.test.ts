import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { db, schema } from "@/db";
import { linkToken } from "@/lib/links";
import {
  allowedNextStatuses,
  checkoutSchema,
  getOrderForCustomer,
  handlePaymentEvent,
  placeOrder,
  quoteCart,
  recordOfflinePayment,
  refundPayment,
  transitionPermission,
  updateOrderStatus,
  type CheckoutInput,
} from "@/lib/orders";
import { parseStripeWebhook } from "@/lib/payments/stripe";
import { configureShop, createAdmin, createTestProduct, futureDate, resetDb, sentTo } from "../support/db";

async function setup() {
  await configureShop();
  return createTestProduct();
}

function checkoutInput(productId: string, optionValueIds: string[], overrides: Partial<z.input<typeof checkoutSchema>> = {}): CheckoutInput {
  return checkoutSchema.parse({
    cart: [{ productId, optionValueIds, quantity: 2 }],
    customerName: "Jamie Customer",
    customerEmail: "jamie@example.test",
    fulfillmentMethod: "pickup",
    fulfillmentDate: futureDate(5),
    ...overrides,
  });
}

async function paymentFor(orderId: string) {
  return (await db().query.payments.findFirst({ where: eq(schema.payments.orderId, orderId) }))!;
}

function paidEvent(id: string, sessionId: string | null, amount: number | null) {
  return { id, provider: "fake" as const, type: "paid" as const, sessionId, paymentIntentId: `pi_${id}`, amountTotalCents: amount, currency: "usd" };
}

async function placedOrder(overrides: Partial<z.input<typeof checkoutSchema>> = {}) {
  const { product, values } = await setup();
  const res = await placeOrder(checkoutInput(product.id, [values.small.id], overrides));
  if (!res.ok) throw new Error(res.message);
  const order = (await db().query.orders.findFirst({ where: eq(schema.orders.id, res.orderId) }))!;
  return { order, payment: await paymentFor(order.id), product, values, res };
}

async function paidOrder() {
  const p = await placedOrder();
  await handlePaymentEvent(paidEvent("evt_paid", p.payment.providerSessionId, p.payment.amountCents));
  return { ...p, order: (await db().query.orders.findFirst({ where: eq(schema.orders.id, p.order.id) }))! };
}

beforeEach(resetDb);

describe("quoteCart", () => {
  it("prices from the database and ignores anything the browser claims", async () => {
    const { product, values } = await setup();
    const q = await quoteCart([{ productId: product.id, optionValueIds: [values.large.id], quantity: 2, unitPriceCents: 1 } as never]);
    expect(q.errors).toEqual([]);
    expect(q.subtotalCents).toBe(11000);
    expect(q.leadTimeHours).toBe(72);
    expect(q.capacityUnits).toBe(2);
  });
  it("prices personalisation text and rejects over-long text", async () => {
    const { product, values, message } = await setup();
    const ok = await quoteCart([{ productId: product.id, optionValueIds: [values.small.id], texts: [{ optionId: message.id, value: "  Happy   30th " }], quantity: 1 }]);
    expect(ok.lines[0].options).toContainEqual({ option: "Message", value: "Happy 30th", priceDeltaCents: 300 });
    expect(ok.subtotalCents).toBe(4300);
    const long = await quoteCart([{ productId: product.id, optionValueIds: [values.small.id], texts: [{ optionId: message.id, value: "x".repeat(21) }], quantity: 1 }]);
    expect(long.errors[0].message).toMatch(/at most 20/);
  });
  it("reports unavailable products as errors", async () => {
    const { product, values } = await setup();
    await db().update(schema.products).set({ status: "unavailable" }).where(eq(schema.products.id, product.id));
    const q = await quoteCart([{ productId: product.id, optionValueIds: [values.small.id], quantity: 1 }]);
    expect(q.lines).toEqual([]);
    expect(q.errors[0].message).toMatch(/isn't available/);
  });
});

describe("placeOrder", () => {
  it("creates a pending, unpaid order with a payment record, a capacity hold and a checkout session", async () => {
    const { product, values } = await setup();
    const res = await placeOrder(checkoutInput(product.id, [values.large.id, values.topper.id]));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.redirectUrl).toMatch(/^\/dev\/fake-checkout\/fake_cs_/);
    const order = await db().query.orders.findFirst({ where: eq(schema.orders.id, res.orderId), with: { items: true, reservation: true, customer: true } });
    expect(order).toMatchObject({ status: "pending", paymentStatus: "unpaid", subtotalCents: 12000, taxCents: 960, totalCents: 12960 });
    expect(order!.reservation).toMatchObject({ status: "held", units: 2 });
    expect(order!.customer?.email).toBe("jamie@example.test");
    expect(await paymentFor(res.orderId)).toMatchObject({ kind: "full", status: "pending", amountCents: 12960 });
  });
  it("adds the delivery fee and taxes it", async () => {
    const { product, values } = await setup();
    await db().update(schema.products).set({ deliveryEligible: true }).where(eq(schema.products.id, product.id));
    const res = await placeOrder(checkoutInput(product.id, [values.small.id], { fulfillmentMethod: "delivery", deliveryAddress: { line1: "1 Main St", city: "Town", region: "NY", postalCode: "10001" } }));
    expect(res.ok).toBe(true);
    expect(await db().query.orders.findFirst()).toMatchObject({ subtotalCents: 8000, deliveryFeeCents: 1500, taxCents: 760, totalCents: 10260 });
  });
  it("rejects delivery for pickup-only products, short lead times and missing tax", async () => {
    const { product, values } = await setup();
    expect(await placeOrder(checkoutInput(product.id, [values.small.id], { fulfillmentMethod: "delivery", deliveryAddress: { line1: "1 Main", city: "T", region: "NY", postalCode: "10001" } }))).toMatchObject({ ok: false, fieldErrors: { fulfillmentMethod: expect.any(String) } });
    expect(await placeOrder(checkoutInput(product.id, [values.small.id], { fulfillmentDate: futureDate(2) }))).toMatchObject({ ok: false, fieldErrors: { fulfillmentDate: expect.stringMatching(/notice/) } });
    await configureShop({ taxRateBps: null });
    expect(await placeOrder(checkoutInput(product.id, [values.small.id]))).toMatchObject({ ok: false, message: expect.stringMatching(/isn't available/) });
    expect(await db().query.orders.findMany()).toHaveLength(0);
  });
  it("requires a configured time window when windows exist", async () => {
    const { product, values } = await setup();
    await configureShop({ fulfillmentWindows: ["10:00–12:00", "14:00–16:00"] });
    expect(await placeOrder(checkoutInput(product.id, [values.small.id]))).toMatchObject({ ok: false, fieldErrors: { fulfillmentWindow: expect.any(String) } });
    expect(await placeOrder(checkoutInput(product.id, [values.small.id], { fulfillmentWindow: "09:00" }))).toMatchObject({ ok: false });
    const ok = await placeOrder(checkoutInput(product.id, [values.small.id], { fulfillmentWindow: "14:00–16:00" }));
    expect(ok.ok).toBe(true);
  });
});

describe("payment events", () => {
  it("confirms the order once, even when the webhook is delivered twice concurrently", async () => {
    const { order, payment } = await placedOrder();
    const evt = paidEvent("evt_1", payment.providerSessionId, payment.amountCents);
    const [a, b] = await Promise.all([handlePaymentEvent(evt), handlePaymentEvent(evt)]);
    expect([a, b].sort()).toEqual(["duplicate", "paid"]);
    expect(await handlePaymentEvent(evt)).toBe("duplicate");
    const after = await db().query.orders.findFirst({ where: eq(schema.orders.id, order.id), with: { reservation: true } });
    expect(after).toMatchObject({ status: "confirmed", paymentStatus: "paid", amountPaidCents: order.totalCents });
    expect(after!.reservation?.status).toBe("confirmed");
    expect(await paymentFor(order.id)).toMatchObject({ status: "succeeded", providerPaymentId: "pi_evt_1" });
    expect(await sentTo("jamie@example.test")).toHaveLength(1);
    expect(await sentTo("owner@example.test")).toHaveLength(1);
  });

  it("a second distinct 'paid' event for the same session changes nothing and sends nothing", async () => {
    const { payment } = await placedOrder();
    expect(await handlePaymentEvent(paidEvent("evt_a", payment.providerSessionId, payment.amountCents))).toBe("paid");
    expect(await handlePaymentEvent(paidEvent("evt_b", payment.providerSessionId, payment.amountCents))).toBe("no_change");
    expect(await sentTo("jamie@example.test")).toHaveLength(1);
  });

  it("ignores an 'expired' event that arrives after payment (out of order)", async () => {
    const { order, payment } = await paidOrder();
    expect(await handlePaymentEvent({ ...paidEvent("evt_late_exp", payment.providerSessionId, null), type: "expired" })).toBe("no_change");
    expect((await db().query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.status).toBe("confirmed");
  });

  it("cancels an abandoned checkout and frees its capacity and discount", async () => {
    await configureShop();
    const [d] = await db().insert(schema.discounts).values({ code: "ONCE", kind: "fixed", value: 500, maxRedemptions: 1 }).returning();
    const { product, values } = await createTestProduct();
    const res = await placeOrder(checkoutInput(product.id, [values.small.id], { discountCode: "once" }));
    if (!res.ok) throw new Error(res.message);
    const payment = await paymentFor(res.orderId);
    expect(await handlePaymentEvent({ ...paidEvent("evt_exp", payment.providerSessionId, null), type: "expired" })).toBe("expired");
    const order = await db().query.orders.findFirst({ where: eq(schema.orders.id, res.orderId), with: { reservation: true, redemption: true } });
    expect(order).toMatchObject({ status: "cancelled", paymentStatus: "unpaid" });
    expect(order!.reservation?.status).toBe("released");
    expect(order!.redemption?.status).toBe("void");
    expect(d.id).toBeTruthy();
    // The single-use code is free again.
    const again = await placeOrder(checkoutInput(product.id, [values.small.id], { discountCode: "ONCE" }));
    expect(again.ok).toBe(true);
  });

  it("emails the customer when an async payment fails", async () => {
    const { order, payment } = await placedOrder();
    expect(await handlePaymentEvent({ ...paidEvent("evt_f", payment.providerSessionId, null), type: "failed" })).toBe("failed");
    expect((await db().query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))).toMatchObject({ status: "cancelled", paymentStatus: "failed" });
    expect((await sentTo("jamie@example.test"))[0].subject).toMatch(/didn't go through/);
  });

  it("flags amount mismatches for review", async () => {
    const { order, payment } = await placedOrder();
    await handlePaymentEvent(paidEvent("evt_m", payment.providerSessionId, 1));
    expect((await db().query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.internalNotes).toMatch(/Amount mismatch/);
  });

  it("asks the provider to retry events it can't match yet, without recording them", async () => {
    await setup();
    expect(await handlePaymentEvent(paidEvent("evt_x", "cs_unknown", 1))).toBe("retry_later");
    expect(await db().query.paymentEvents.findMany()).toHaveLength(0);
  });

  it("verifies Stripe webhook signatures and parses refund events", () => {
    const secret = "whsec_test_secret";
    const payload = JSON.stringify({ id: "evt_s1", object: "event", type: "checkout.session.completed", data: { object: { id: "cs_1", object: "checkout.session", payment_status: "paid", payment_intent: "pi_9", amount_total: 4320, currency: "usd" } } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(parseStripeWebhook(payload, header, secret)).toMatchObject({ id: "evt_s1", type: "paid", sessionId: "cs_1", amountTotalCents: 4320 });
    expect(() => parseStripeWebhook(payload, header, "whsec_other")).toThrow();
    expect(() => parseStripeWebhook(payload.replace("4320", "1"), header, secret)).toThrow();
    expect(() => parseStripeWebhook(payload, null, secret)).toThrow();
    const refund = JSON.stringify({ id: "evt_r1", object: "event", type: "refund.updated", data: { object: { id: "re_1", object: "refund", status: "succeeded", amount: 500, currency: "usd" } } });
    expect(parseStripeWebhook(refund, Stripe.webhooks.generateTestHeaderString({ payload: refund, secret }), secret)).toMatchObject({ type: "refund_succeeded", refundId: "re_1" });
  });
});

describe("refunds and offline payments", () => {
  it("refunds part of a payment, then the rest, updating payment status and notifying", async () => {
    const { order, payment } = await paidOrder();
    const actor = await createAdmin();
    expect(await refundPayment(actor, payment.id, 1000, "One cake was damaged")).toMatchObject({ ok: true, pending: false });
    let after = (await db().query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
    expect(after).toMatchObject({ paymentStatus: "partially_refunded", amountRefundedCents: 1000 });
    expect(await refundPayment(actor, payment.id, order.totalCents, "too much")).toMatchObject({ ok: false });
    expect(await refundPayment(actor, payment.id, order.totalCents - 1000, "Order cancelled")).toMatchObject({ ok: true });
    after = (await db().query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
    expect(after).toMatchObject({ paymentStatus: "refunded", amountRefundedCents: order.totalCents });
    expect((await sentTo("jamie@example.test")).filter((m) => /Refund/.test(m.subject))).toHaveLength(2);
    expect(await refundPayment(actor, payment.id, 1, "again")).toMatchObject({ ok: false });
  });

  it("records an offline payment with a reason and confirms the order", async () => {
    const { order } = await placedOrder();
    const actor = await createAdmin("order_manager");
    expect(await recordOfflinePayment(actor, order.id, { amountCents: order.totalCents + 1, method: "cash", note: "x" })).toMatchObject({ ok: false });
    expect(await recordOfflinePayment(actor, order.id, { amountCents: order.totalCents, method: "cash", note: "Paid at the counter" })).toMatchObject({ ok: true });
    expect(await db().query.orders.findFirst({ where: eq(schema.orders.id, order.id) })).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    const audit = await db().query.auditLog.findMany({ where: eq(schema.auditLog.action, "payment.offline_recorded") });
    expect(audit[0].details).toMatchObject({ method: "cash", note: "Paid at the counter" });
  });
});

describe("order status transitions", () => {
  it("never allows confirming without payment, and gates completion on full payment", async () => {
    const { order } = await placedOrder();
    const actor = await createAdmin();
    expect(allowedNextStatuses(order)).toEqual(["cancelled"]);
    expect(await updateOrderStatus(actor, order.id, "confirmed")).toMatchObject({ ok: false });
    expect(await updateOrderStatus(actor, order.id, "cancelled")).toMatchObject({ ok: false, message: expect.stringMatching(/reason/) });
  });

  it("walks through production, sends status emails, and supports hold/resume", async () => {
    const { order } = await paidOrder();
    const actor = await createAdmin("production");
    expect(await updateOrderStatus(actor, order.id, "in_production")).toMatchObject({ ok: true, notified: true });
    expect(await updateOrderStatus(actor, order.id, "on_hold", { reason: "Waiting for topper" })).toMatchObject({ ok: true });
    const held = (await db().query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
    expect(allowedNextStatuses(held)).toEqual(["in_production", "cancelled"]);
    expect(await updateOrderStatus(actor, order.id, "in_production")).toMatchObject({ ok: true });
    expect(await updateOrderStatus(actor, order.id, "ready")).toMatchObject({ ok: true });
    expect(await updateOrderStatus(actor, order.id, "completed")).toMatchObject({ ok: true });
    const subjects = (await sentTo("jamie@example.test")).map((m) => m.subject);
    expect(subjects).toEqual(expect.arrayContaining([expect.stringMatching(/being prepared/), expect.stringMatching(/is ready/), expect.stringMatching(/is complete/)]));
    // Re-entering "in production" after a hold doesn't email twice.
    expect(subjects.filter((x) => /being prepared/.test(x))).toHaveLength(1);
  });

  it("cancelling releases capacity and emails the customer", async () => {
    const { order } = await paidOrder();
    const actor = await createAdmin();
    expect(await updateOrderStatus(actor, order.id, "cancelled", { reason: "Customer asked to cancel" })).toMatchObject({ ok: true });
    const after = await db().query.orders.findFirst({ where: eq(schema.orders.id, order.id), with: { reservation: true } });
    expect(after!.reservation?.status).toBe("released");
    expect((await sentTo("jamie@example.test")).some((m) => /cancelled/.test(m.subject))).toBe(true);
  });

  it("maps transitions to permissions", () => {
    expect(transitionPermission("confirmed", "in_production")).toBe("orders:progress");
    expect(transitionPermission("ready", "completed")).toBe("orders:progress");
    expect(transitionPermission("confirmed", "cancelled")).toBe("orders:manage");
    expect(transitionPermission("confirmed", "on_hold")).toBe("orders:manage");
  });
});

describe("customer order access", () => {
  it("only shows an order with its signed link token", async () => {
    const { order } = await placedOrder();
    expect(await getOrderForCustomer(order.reference, linkToken("order", order.id))).not.toBeNull();
    expect(await getOrderForCustomer(order.reference, "wrong-token")).toBeNull();
    expect(await getOrderForCustomer(order.reference, undefined)).toBeNull();
  });
});
