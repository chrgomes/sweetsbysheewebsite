import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";
import type { CheckoutSession, CreateCheckoutInput, PaymentEvent, PaymentProvider, RefundResult } from "./types";

let client: Stripe | undefined;

function stripe(): Stripe {
  client ??= new Stripe(env().STRIPE_SECRET_KEY!, { maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

function sessionEvent(id: string, type: PaymentEvent["type"], s: Stripe.Checkout.Session): PaymentEvent {
  return {
    id,
    provider: "stripe",
    type,
    sessionId: s.id,
    paymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null),
    amountTotalCents: s.amount_total,
    currency: s.currency,
  };
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",
  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        line_items: input.lines.map((l) => ({
          quantity: l.quantity,
          price_data: {
            currency: input.currency,
            unit_amount: l.unitAmountCents,
            product_data: { name: l.name, ...(l.description ? { description: l.description.slice(0, 480) } : {}) },
          },
        })),
        customer_email: input.customerEmail,
        client_reference_id: input.orderId,
        metadata: { orderId: input.orderId, paymentId: input.paymentId, reference: input.reference },
        payment_intent_data: { metadata: { orderId: input.orderId, paymentId: input.paymentId, reference: input.reference } },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      },
      // A retried request for the same payment record never creates a second session.
      { idempotencyKey: `checkout-${input.paymentId}` },
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { sessionId: session.id, url: session.url };
  },

  async refund({ providerPaymentId, amountCents, idempotencyKey }): Promise<RefundResult> {
    const r = await stripe().refunds.create({ payment_intent: providerPaymentId, amount: amountCents }, { idempotencyKey: `refund-${idempotencyKey}` });
    return {
      refundId: r.id,
      status: r.status === "succeeded" ? "succeeded" : r.status === "failed" || r.status === "canceled" ? "failed" : "pending",
      failureReason: r.failure_reason ?? null,
    };
  },

  async recoverSession(sessionId: string): Promise<PaymentEvent | null> {
    const s = await stripe().checkout.sessions.retrieve(sessionId);
    if (s.payment_status === "paid") return sessionEvent(`recover:${s.id}:paid`, "paid", s);
    if (s.status === "expired") return sessionEvent(`recover:${s.id}:expired`, "expired", s);
    return null;
  },
};

/** Verify the Stripe-Signature header and normalise the event. Throws if the signature is invalid. */
export function parseStripeWebhook(rawBody: string, signature: string | null, secret = env().STRIPE_WEBHOOK_SECRET!): PaymentEvent {
  if (!signature) throw new Error("Missing Stripe-Signature header");
  const event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
  const base: PaymentEvent = { id: event.id, provider: "stripe", type: "ignored", sessionId: null, paymentIntentId: null, amountTotalCents: null, currency: null };
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object as Stripe.Checkout.Session;
      // "completed" with an unpaid status means a delayed method (e.g. bank debit) is still processing.
      return sessionEvent(event.id, s.payment_status === "paid" ? "paid" : "ignored", s);
    }
    case "checkout.session.async_payment_failed":
      return sessionEvent(event.id, "failed", event.data.object as Stripe.Checkout.Session);
    case "checkout.session.expired":
      return sessionEvent(event.id, "expired", event.data.object as Stripe.Checkout.Session);
    case "refund.created":
    case "refund.updated":
    case "refund.failed": {
      const r = event.data.object as Stripe.Refund;
      const type = r.status === "succeeded" ? "refund_succeeded" : r.status === "failed" || r.status === "canceled" ? "refund_failed" : "ignored";
      return { ...base, type, refundId: r.id, amountTotalCents: r.amount, currency: r.currency, failureReason: r.failure_reason ?? null };
    }
    default:
      return base;
  }
}
