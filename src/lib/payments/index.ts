import "server-only";
import { env } from "@/lib/env";
import { fakeProvider } from "./fake";
import { stripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

const fakeAllowed = () => !(env().NODE_ENV === "production" && env().APP_ENV === "production");

/** The provider new checkouts use, or null when online payment is off. */
export function paymentProvider(): PaymentProvider | null {
  switch (env().PAYMENTS_PROVIDER) {
    case "stripe":
      return stripeProvider;
    case "fake":
      return fakeAllowed() ? fakeProvider : null;
    default:
      return null;
  }
}

/** The provider that handled an existing payment (for refunds and recovery). */
export function providerByName(name: string): PaymentProvider | null {
  if (name === "stripe") return env().STRIPE_SECRET_KEY ? stripeProvider : null;
  if (name === "fake") return fakeAllowed() ? fakeProvider : null;
  return null;
}

export type { PaymentEvent, PaymentProvider } from "./types";
