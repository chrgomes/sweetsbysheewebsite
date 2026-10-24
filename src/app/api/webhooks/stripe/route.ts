import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { handlePaymentEvent } from "@/lib/orders";
import { parseStripeWebhook } from "@/lib/payments/stripe";

/**
 * Stripe webhook endpoint. The signature is verified against the raw body
 * before anything is trusted; processing is idempotent by event id, so
 * Stripe's retries are safe.
 */
export async function POST(request: Request) {
  if (env().PAYMENTS_PROVIDER !== "stripe") return new Response("Not configured", { status: 404 });
  const body = await request.text();
  let event;
  try {
    event = parseStripeWebhook(body, request.headers.get("stripe-signature"));
  } catch (err) {
    log.warn("stripe.webhook_rejected", { error: String(err) });
    return new Response("Invalid signature", { status: 400 });
  }
  try {
    const outcome = await handlePaymentEvent(event);
    return Response.json({ received: true, outcome });
  } catch (err) {
    log.error("stripe.webhook_failed", { eventId: event.id, error: String(err) });
    // 500 makes Stripe retry later; the event wasn't recorded because the transaction rolled back.
    return new Response("Processing failed", { status: 500 });
  }
}
