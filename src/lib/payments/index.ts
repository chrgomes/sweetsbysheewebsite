import "server-only";
import { env } from "@/lib/env";
import { fakeProvider } from "./fake";
import { stripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

export function paymentProvider(): PaymentProvider | null {
  switch (env().PAYMENTS_PROVIDER) {
    case "stripe":
      return stripeProvider;
    case "fake":
      return env().NODE_ENV === "production" && env().APP_ENV === "production" ? null : fakeProvider;
    default:
      return null;
  }
}

export type { PaymentEvent, PaymentProvider } from "./types";
