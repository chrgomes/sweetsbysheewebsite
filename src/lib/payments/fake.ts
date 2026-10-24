import "server-only";
import { randomToken } from "@/lib/tokens";
import type { CheckoutSession, CreateCheckoutInput, PaymentProvider } from "./types";

/**
 * Local/e2e stand-in for a hosted checkout page. Refused in production by
 * env validation. Its "hosted page" is /dev/fake-checkout/<sessionId>.
 */
export const fakeProvider: PaymentProvider = {
  name: "fake",
  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const sessionId = `fake_cs_${randomToken(12)}`;
    const params = new URLSearchParams({ success: input.successUrl, cancel: input.cancelUrl });
    return { sessionId, url: `/dev/fake-checkout/${sessionId}?${params}` };
  },
};
