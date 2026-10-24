import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClearCart, RefreshWhilePending } from "@/components/shop/clear-cart";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Container, Eyebrow } from "@/components/ui/container";
import { FormAlert } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { describeFulfillment, getOrderForCustomer, ORDER_STATUS_LABELS } from "@/lib/orders";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

export default async function OrderStatusPage({ params, searchParams }: PageProps<"/order/[reference]">) {
  const { reference } = await params;
  const { t } = await searchParams;
  const order = await getOrderForCustomer(reference, typeof t === "string" ? t : undefined);
  if (!order) notFound();
  const settings = await getSettings();
  const pending = order.status === "pending_payment";
  const failed = order.status === "payment_failed" || order.status === "cancelled";
  const cur = order.currency;

  return (
    <Container size="narrow" className="py-12 lg:py-20">
      {!failed && <ClearCart />}
      {pending && <RefreshWhilePending />}
      <Eyebrow>Order {order.reference}</Eyebrow>
      <h1 className="mt-3 text-4xl font-light text-ink sm:text-5xl">
        {pending ? "Confirming your payment…" : failed ? "This order wasn't completed" : `Thank you, ${order.customerName.split(" ")[0]}!`}
      </h1>
      <div className="mt-6" role="status">
        {pending && <FormAlert tone="info">We&apos;re waiting for confirmation from the payment provider. This page updates automatically — it usually takes a few seconds.</FormAlert>}
        {failed && <FormAlert>Payment didn&apos;t go through, so this order hasn&apos;t been placed. You can try again from your cart.</FormAlert>}
        {!pending && !failed && <p className="text-lg text-ink-soft">Your payment was received and your order is confirmed. A confirmation email is on its way to {order.customerEmail}.</p>}
      </div>

      <div className="mt-10 rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl text-ink">{describeFulfillment(order)}</h2>
          <Badge tone={failed ? "danger" : pending ? "honey" : "sage"}>{ORDER_STATUS_LABELS[order.status]}</Badge>
        </div>
        {order.fulfillmentMethod === "pickup" && settings.pickupInstructions && !failed && <p className="mt-3 text-ink-soft">{settings.pickupInstructions}</p>}
        <ul className="mt-6 divide-y divide-line border-y border-line text-sm">
          {order.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-4 py-3">
              <span>
                {i.quantity} × {i.productName}
                {i.options.length > 0 && <span className="block text-ink-muted">{i.options.map((o) => `${o.option}: ${o.value}`).join(" · ")}</span>}
              </span>
              <span>{formatMoney(i.lineTotalCents, cur)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-ink-soft">Subtotal</dt><dd>{formatMoney(order.subtotalCents, cur)}</dd></div>
          {order.deliveryFeeCents > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Delivery</dt><dd>{formatMoney(order.deliveryFeeCents, cur)}</dd></div>}
          <div className="flex justify-between"><dt className="text-ink-soft">{settings.taxLabel}</dt><dd>{formatMoney(order.taxCents, cur)}</dd></div>
          <div className="flex justify-between border-t border-line pt-3 text-base font-medium"><dt>Total</dt><dd>{formatMoney(order.totalCents, cur)}</dd></div>
        </dl>
      </div>
      <p className="mt-6 text-sm text-ink-muted">Keep this page&apos;s link to check your order status later.</p>
      <div className="mt-8 flex gap-3">
        <ButtonLink href={failed ? "/cart" : "/shop"} variant="secondary">{failed ? "Back to cart" : "Continue browsing"}</ButtonLink>
      </div>
    </Container>
  );
}
