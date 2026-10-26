export type CheckoutLine = { name: string; description?: string; unitAmountCents: number; quantity: number };

export type CreateCheckoutInput = {
  /** Our payment record; echoed back in metadata and used as the idempotency key. */
  paymentId: string;
  orderId: string;
  reference: string;
  currency: string;
  customerEmail: string;
  /** Final line items; their total is exactly what the customer is charged. */
  lines: CheckoutLine[];
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSession = { sessionId: string; url: string };

/** Provider-neutral payment event, produced only after the provider's signature is verified. */
export type PaymentEvent = {
  id: string;
  provider: "stripe" | "fake";
  type: "paid" | "failed" | "expired" | "refund_succeeded" | "refund_failed" | "ignored";
  sessionId: string | null;
  paymentIntentId: string | null;
  amountTotalCents: number | null;
  currency: string | null;
  refundId?: string | null;
  failureReason?: string | null;
};

export type RefundResult = { refundId: string; status: "pending" | "succeeded" | "failed"; failureReason?: string | null };

export interface PaymentProvider {
  readonly name: "stripe" | "fake";
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /** Refund part or all of a captured payment. `idempotencyKey` makes retries safe. */
  refund(p: { providerPaymentId: string; amountCents: number; idempotencyKey: string }): Promise<RefundResult>;
  /** Look up a session directly, to recover from a missed webhook. Null when there's nothing to report. */
  recoverSession(sessionId: string): Promise<PaymentEvent | null>;
}
