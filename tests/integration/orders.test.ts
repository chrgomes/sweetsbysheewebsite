import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { memoryOutbox } from "@/lib/email";
import type { z } from "zod";
import { checkoutSchema, getOrderForCustomer, handlePaymentEvent, placeOrder, quoteCart, updateOrderStatus, type CheckoutInput } from "@/lib/orders";
import { parseStripeWebhook } from "@/lib/payments/stripe";
import { configureShop, createTestProduct, futureDate, resetDb } from "../support/db";

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

beforeEach(resetDb);

describe("quoteCart", () => {
  it("prices from the database and ignores anything the browser claims", async () => {
    const { product, values } = await setup();
    const q = await quoteCart([{ productId: product.id, optionValueIds: [values.large.id], quantity: 2, unitPriceCents: 1 } as never]);
    expect(q.errors).toEqual([]);
    expect(q.subtotalCents).toBe(11000);
    expect(q.leadTimeHours).toBe(72);
  });
  it("reports unavailable products and invalid options as errors", async () => {
    const { product, values } = await setup();
    await db().update(schema.products).set({ status: "unavailable" }).where(eq(schema.products.id, product.id));
    const q = await quoteCart([{ productId: product.id, optionValueIds: [values.small.id], quantity: 1 }]);
    expect(q.lines).toEqual([]);
    expect(q.errors[0].message).toMatch(/isn't available/);
  });
});

describe("placeOrder", () => {
  it("creates a pending order with server-computed totals and a checkout session", async () => {
    const { product, values } = await setup();
    const res = await placeOrder(checkoutInput(product.id, [values.large.id, values.topper.id]));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.redirectUrl).toMatch(/^\/dev\/fake-checkout\/fake_cs_/);
    const order = await db().query.orders.findFirst({ where: eq(schema.orders.id, res.orderId), with: { items: true } });
    expect(order).toMatchObject({ status: "pending_payment", subtotalCents: 12000, taxCents: 960, deliveryFeeCents: 0, totalCents: 12960 });
    expect(order!.items[0]).toMatchObject({ productName: "Test Cake", unitPriceCents: 6000, quantity: 2 });
  });
  it("adds the delivery fee and taxes it", async () => {
    const { product, values } = await setup();
    await db().update(schema.products).set({ deliveryEligible: true }).where(eq(schema.products.id, product.id));
    const res = await placeOrder(
      checkoutInput(product.id, [values.small.id], {
        fulfillmentMethod: "delivery",
        deliveryAddress: { line1: "1 Main St", city: "Town", region: "NY", postalCode: "10001" },
      }),
    );
    expect(res.ok).toBe(true);
    const order = await db().query.orders.findFirst();
    expect(order).toMatchObject({ subtotalCents: 8000, deliveryFeeCents: 1500, taxCents: 760, totalCents: 10260 });
  });
  it("rejects delivery for pickup-only products", async () => {
    const { product, values } = await setup();
    const res = await placeOrder(
      checkoutInput(product.id, [values.small.id], { fulfillmentMethod: "delivery", deliveryAddress: { line1: "1 Main", city: "T", region: "NY", postalCode: "10001" } }),
    );
    expect(res).toMatchObject({ ok: false, fieldErrors: { fulfillmentMethod: expect.any(String) } });
  });
  it("respects the product's lead time", async () => {
    const { product, values } = await setup();
    const res = await placeOrder(checkoutInput(product.id, [values.small.id], { fulfillmentDate: futureDate(2) }));
    expect(res).toMatchObject({ ok: false, fieldErrors: { fulfillmentDate: expect.stringMatching(/notice/) } });
  });
  it("refuses checkout until tax is configured", async () => {
    const { product, values } = await setup();
    await configureShop({ taxRateBps: null });
    const res = await placeOrder(checkoutInput(product.id, [values.small.id]));
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/isn't available/) });
    expect(await db().query.orders.findMany()).toHaveLength(0);
  });
  it("refuses invalid option combinations", async () => {
    const { product, values } = await setup();
    const res = await placeOrder(checkoutInput(product.id, [values.small.id, values.large.id]));
    expect(res).toMatchObject({ ok: false, lineErrors: [expect.objectContaining({ productId: product.id })] });
  });
});

describe("payment events", () => {
  async function pendingOrder() {
    const { product, values } = await setup();
    const res = await placeOrder(checkoutInput(product.id, [values.small.id]));
    if (!res.ok) throw new Error(res.message);
    return (await db().query.orders.findFirst({ where: eq(schema.orders.id, res.orderId) }))!;
  }

  it("marks the order paid once, even when the webhook is delivered twice", async () => {
    const order = await pendingOrder();
    const evt = { id: "evt_1", provider: "fake" as const, type: "paid" as const, sessionId: order.paymentSessionId, paymentIntentId: "pi_1", amountTotalCents: order.totalCents, currency: "usd" };
    const [a, b] = await Promise.all([handlePaymentEvent(evt), handlePaymentEvent(evt)]);
    expect([a, b].sort()).toEqual(["duplicate", "paid"]);
    expect(await handlePaymentEvent(evt)).toBe("duplicate");
    const after = await db().query.orders.findFirst({ where: eq(schema.orders.id, order.id) });
    expect(after).toMatchObject({ status: "paid", paymentIntentId: "pi_1" });
    expect(after!.confirmationEmailSentAt).not.toBeNull();
    const toCustomer = memoryOutbox().filter((m) => m.to === "jamie@example.test");
    expect(toCustomer).toHaveLength(1);
    expect(memoryOutbox().filter((m) => m.to === "owner@example.test")).toHaveLength(1);
  });

  it("a second distinct 'paid' event for the same order changes nothing", async () => {
    const order = await pendingOrder();
    const base = { provider: "fake" as const, type: "paid" as const, sessionId: order.paymentSessionId, paymentIntentId: "pi", amountTotalCents: order.totalCents, currency: "usd" };
    expect(await handlePaymentEvent({ ...base, id: "evt_a" })).toBe("paid");
    expect(await handlePaymentEvent({ ...base, id: "evt_b" })).toBe("no_change");
    expect(memoryOutbox().filter((m) => m.to === "jamie@example.test")).toHaveLength(1);
  });

  it("records failed and expired payments without marking paid", async () => {
    const order = await pendingOrder();
    expect(await handlePaymentEvent({ id: "evt_f", provider: "fake", type: "failed", sessionId: order.paymentSessionId, paymentIntentId: null, amountTotalCents: null, currency: null })).toBe("failed");
    expect((await db().query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.status).toBe("payment_failed");
  });

  it("flags amount mismatches for review", async () => {
    const order = await pendingOrder();
    await handlePaymentEvent({ id: "evt_m", provider: "fake", type: "paid", sessionId: order.paymentSessionId, paymentIntentId: null, amountTotalCents: 1, currency: "usd" });
    const after = await db().query.orders.findFirst({ where: eq(schema.orders.id, order.id) });
    expect(after!.internalNotes).toMatch(/Amount mismatch/);
  });

  it("ignores events for unknown sessions", async () => {
    await setup();
    expect(await handlePaymentEvent({ id: "evt_x", provider: "fake", type: "paid", sessionId: "nope", paymentIntentId: null, amountTotalCents: 1, currency: "usd" })).toBe("unknown_order");
  });

  it("verifies Stripe webhook signatures", () => {
    const secret = "whsec_test_secret";
    const payload = JSON.stringify({
      id: "evt_stripe_1",
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_1", object: "checkout.session", payment_status: "paid", payment_intent: "pi_9", amount_total: 4320, currency: "usd" } },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(parseStripeWebhook(payload, header, secret)).toMatchObject({ id: "evt_stripe_1", type: "paid", sessionId: "cs_test_1", amountTotalCents: 4320 });
    expect(() => parseStripeWebhook(payload, header, "whsec_other")).toThrow();
    expect(() => parseStripeWebhook(payload.replace("4320", "1"), header, secret)).toThrow();
    expect(() => parseStripeWebhook(payload, null, secret)).toThrow();
  });

  it("treats completed-but-unpaid Stripe sessions as not paid", () => {
    const secret = "whsec_test_secret";
    const payload = JSON.stringify({ id: "evt_2", object: "event", type: "checkout.session.completed", data: { object: { id: "cs_2", payment_status: "unpaid", amount_total: 100, currency: "usd" } } });
    expect(parseStripeWebhook(payload, Stripe.webhooks.generateTestHeaderString({ payload, secret }), secret).type).toBe("ignored");
  });
});

describe("order access and status", () => {
  it("only shows an order with the right token", async () => {
    const { product, values } = await setup();
    const res = await placeOrder(checkoutInput(product.id, [values.small.id]));
    if (!res.ok) throw new Error();
    const order = (await db().query.orders.findFirst())!;
    const token = new URL(`http://x${decodeURIComponent(res.redirectUrl.split("success=")[1].split("&")[0])}`.replace("http://xhttp://localhost:3000", "http://x")).searchParams.get("t")!;
    expect(await getOrderForCustomer(order.reference, token)).not.toBeNull();
    expect(await getOrderForCustomer(order.reference, "wrong-token")).toBeNull();
    expect(await getOrderForCustomer(order.reference, undefined)).toBeNull();
  });
  it("only allows valid status transitions, and never to paid", async () => {
    const { product, values } = await setup();
    await placeOrder(checkoutInput(product.id, [values.small.id]));
    const order = (await db().query.orders.findFirst())!;
    const actor = { id: null, label: "test" };
    expect((await updateOrderStatus(actor, order.id, "paid")).ok).toBe(false);
    expect((await updateOrderStatus(actor, order.id, "completed")).ok).toBe(false);
    expect((await updateOrderStatus(actor, order.id, "cancelled")).ok).toBe(true);
    expect(await db().query.auditLog.findMany()).toHaveLength(1);
  });
});
