import { env, siteUrl } from "@/lib/env";
import { hmac, safeEqual } from "@/lib/tokens";

/**
 * Unguessable customer links for orders, requests and quotes, derived from the
 * record id and APP_SECRET. Nothing secret is stored, and "Find my orders" can
 * re-send working links. Rotating APP_SECRET invalidates every link.
 */
export type LinkKind = "order" | "inquiry" | "quote";

export function linkToken(kind: LinkKind, id: string): string {
  return hmac(env().APP_SECRET, `link:${kind}:${id}`).slice(0, 40);
}

export function verifyLinkToken(kind: LinkKind, id: string, token: string | undefined | null): boolean {
  return !!token && token.length <= 100 && safeEqual(token, linkToken(kind, id));
}

export function orderLink(order: { id: string; reference: string }) {
  return siteUrl(`/order/${order.reference}?t=${linkToken("order", order.id)}`);
}

export function quoteLink(quote: { id: string; reference: string }) {
  return siteUrl(`/quotes/${quote.reference}?t=${linkToken("quote", quote.id)}`);
}

export function inquiryLink(inquiry: { id: string; reference: string }) {
  return siteUrl(`/requests/${inquiry.reference}?t=${linkToken("inquiry", inquiry.id)}`);
}
