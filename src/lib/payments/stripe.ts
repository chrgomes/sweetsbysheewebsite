import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";
import type { CheckoutSession, CreateCheckoutInput, PaymentEvent, PaymentProvider } from "./types";

let client: Stripe | undefined;

function stripe(): Stripe {
  client ??= new Stripe(env().STRIPE_SECRET_KEY!, { maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",
  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const automaticTax = env().STRIPE_AUTOMATIC_TAX;
    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = input.lines.map((l) => ({
      quantity: l.quantity,
      price_data: {
        currency: input.currency,
        unit_amount: l.unitAmountCents,
        product_data: { name: l.name, ...(l.description ? { description: l.description } : {}) },
      },
    }));
    if (input.deliveryFeeCents > 0) {
      line_items.push({ quantity: 1, price_data: { currency: input.currency, unit_amount: input.deliveryFeeCents, product_data: { name: "Delivery" } } });
    }
    if (!automaticTax && input.taxCents > 0) {
      line_items.push({ quantity: 1, price_data: { currency: input.currency, unit_amount: input.taxCents, product_data: { name: input.taxLabel } } });
    }
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        line_items,
        customer_email: input.customerEmail,
        client_reference_id: input.orderId,
        metadata: { orderId: input.orderId, reference: input.reference },
        payment_intent_data: { metadata: { orderId: input.orderId, reference: input.reference } },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
        ...(automaticTax ? { automatic_tax: { enabled: true } } : {}),
      },
      // Retrying the same order never creates a second Checkout Session.
      { idempotencyKey: `checkout-${input.orderId}` },
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { sessionId: session.id, url: session.url };
  },
};

/** Verify the Stripe-Signature header and normalise the event. Throws if the signature is invalid. */
export function parseStripeWebhook(rawBody: string, signature: string | null, secret = env().STRIPE_WEBHOOK_SECRET!): PaymentEvent {
  if (!signature) throw new Error("Missing Stripe-Signature header");
  const event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
  const base = { id: event.id, provider: "stripe" as const, sessionId: null, paymentIntentId: null, amountTotalCents: null, currency: null };
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const s = event.data.object as Stripe.Checkout.Session;
      const type =
        event.type === "checkout.session.expired"
          ? "expired"
          : event.type === "checkout.session.async_payment_failed"
            ? "failed"
            : s.payment_status === "paid"
              ? "paid"
              : "ignored"; // completed but awaiting async payment (e.g. bank debit)
      return {
        ...base,
        type,
        sessionId: s.id,
        paymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null),
        amountTotalCents: s.amount_total,
        currency: s.currency,
      };
    }
    default:
      return { ...base, type: "ignored" };
  }
}
