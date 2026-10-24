export type CheckoutLine = { name: string; description?: string; unitAmountCents: number; quantity: number };

export type CreateCheckoutInput = {
  orderId: string;
  reference: string;
  currency: string;
  customerEmail: string;
  lines: CheckoutLine[];
  /** Tax and delivery are passed as explicit lines so Stripe charges exactly what we computed. */
  taxCents: number;
  taxLabel: string;
  deliveryFeeCents: number;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSession = { sessionId: string; url: string };

/** Provider-neutral payment event, produced only after the provider's signature is verified. */
export type PaymentEvent = {
  id: string;
  provider: "stripe" | "fake";
  type: "paid" | "failed" | "expired" | "ignored";
  sessionId: string | null;
  paymentIntentId: string | null;
  amountTotalCents: number | null;
  currency: string | null;
};

export interface PaymentProvider {
  readonly name: "stripe" | "fake";
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
}
