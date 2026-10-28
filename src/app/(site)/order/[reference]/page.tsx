import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { payOrderAction } from "@/app/actions/customer";
import { ClearCart, RefreshWhilePending } from "@/components/shop/clear-cart";
import { SimpleActionForm } from "@/components/site/simple-action-form";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Container, Eyebrow } from "@/components/ui/container";
import { FormAlert } from "@/components/ui/field";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { amountDue, describeFulfillment, getOrderForCustomer, PAYMENT_STATUS_LABELS, statusLabel } from "@/lib/orders";
import { paymentProvider } from "@/lib/payments";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

const STEPS = ["confirmed", "in_production", "ready", "completed"] as const;

export default async function OrderStatusPage({ params, searchParams }: PageProps<"/order/[reference]">) {
  const { reference } = await params;
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : undefined;
  const order = await getOrderForCustomer(reference, token);
  if (!order) notFound();
  const settings = await getSettings();
  const cur = order.currency;
  const fromQuote = !!order.sourceQuoteId;
  const pendingCheckout = order.payments.some((p) => p.status === "pending" && p.provider !== "offline");
  const awaitingWebhook = order.status === "pending" && pendingCheckout && !fromQuote;
  const cancelled = order.status === "cancelled";
  const depositDue = amountDue(order, "deposit");
  const balanceDue = amountDue(order, "full");
  const canPayOnline = paymentProvider() !== null && !cancelled && order.status !== "completed" && balanceDue > 0;
  const stepIndex = STEPS.indexOf(order.status as (typeof STEPS)[number]);

  let heading = `Thank you, ${order.customerName.split(" ")[0]}!`;
  if (cancelled) heading = "This order was cancelled";
  else if (awaitingWebhook) heading = "Confirming your payment…";
  else if (order.status === "pending") heading = depositDue > 0 ? "Pay your deposit to confirm" : "Complete payment to confirm";

  return (
    <Container size="narrow" className="py-12 lg:py-20">
      {!cancelled && !fromQuote && <ClearCart />}
      {awaitingWebhook && <RefreshWhilePending />}
      <Eyebrow>Order {order.reference}</Eyebrow>
      <h1 className="mt-3 text-4xl font-light text-ink sm:text-5xl">{heading}</h1>

      <div className="mt-6 space-y-4" role="status">
        {awaitingWebhook && <FormAlert tone="info">We&apos;re waiting for confirmation from the payment provider. This page updates automatically — it usually takes a few seconds.</FormAlert>}
        {cancelled && <FormAlert>{order.cancelReason ?? "This order isn't going ahead."} {order.amountPaidCents > order.amountRefundedCents && "If a refund is due, we'll email you when it's issued."}</FormAlert>}
        {order.status === "pending" && !awaitingWebhook && !cancelled && (
          <FormAlert tone="info">
            Your date is not booked until {depositDue > 0 ? `the deposit of ${formatMoney(depositDue, cur)} is paid` : "payment is complete"}.
            {!canPayOnline && " We'll contact you to arrange payment."}
          </FormAlert>
        )}
        {!["pending", "cancelled"].includes(order.status) && <p className="text-lg text-ink-soft">Your order is confirmed. We&apos;ve emailed the details to {order.customerEmail}.</p>}
      </div>

      {canPayOnline && order.status !== "pending" ? (
        <div className="mt-6 rounded-2xl border border-honey/30 bg-honey-tint p-5">
          <p className="text-ink">Remaining balance: <strong>{formatMoney(balanceDue, cur)}</strong></p>
          <SimpleActionForm action={payOrderAction} hidden={{ reference: order.reference, t: token! }} submitLabel="Pay the balance" pendingLabel="Starting secure payment…" className="mt-3 space-y-3" />
        </div>
      ) : canPayOnline && order.status === "pending" && !awaitingWebhook ? (
        <div className="mt-6">
          <SimpleActionForm action={payOrderAction} hidden={{ reference: order.reference, t: token! }} submitLabel={depositDue > 0 ? `Pay ${formatMoney(depositDue, cur)} deposit` : `Pay ${formatMoney(balanceDue, cur)}`} pendingLabel="Starting secure payment…" />
        </div>
      ) : null}

      {!cancelled && order.status !== "pending" && (
        <ol className="mt-10 grid grid-cols-4 gap-2 text-center text-xs sm:text-sm" aria-label="Order progress">
          {STEPS.map((st, i) => {
            const done = order.status === "on_hold" ? false : i <= stepIndex;
            const label = st === "ready" ? (order.fulfillmentMethod === "pickup" ? "Ready for pickup" : "Ready for delivery") : st === "in_production" ? "In production" : st[0].toUpperCase() + st.slice(1);
            return (
              <li key={st} aria-current={i === stepIndex ? "step" : undefined} className={done ? "text-ink" : "text-ink-muted"}>
                <span className={`mx-auto mb-2 block h-1.5 rounded-full ${done ? "bg-berry" : "bg-line"}`} />
                {label}
              </li>
            );
          })}
        </ol>
      )}
      {order.status === "on_hold" && <p className="mt-6 text-sm text-ink-soft">Your order is temporarily on hold. We&apos;ll be in touch.</p>}

      <div className="mt-10 rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl text-ink">{describeFulfillment(order)}</h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone={cancelled ? "danger" : order.status === "pending" ? "honey" : "sage"}>{statusLabel(order)}</Badge>
            <Badge tone={order.paymentStatus === "paid" ? "sage" : "neutral"}>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</Badge>
          </div>
        </div>
        {order.fulfillmentMethod === "pickup" && settings.pickupInstructions && !cancelled && <p className="mt-3 text-ink-soft">{settings.pickupInstructions}</p>}
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
          {order.discountCents > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Discount{order.discountCode ? ` (${order.discountCode})` : ""}</dt><dd>−{formatMoney(order.discountCents, cur)}</dd></div>}
          {order.deliveryFeeCents > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Delivery</dt><dd>{formatMoney(order.deliveryFeeCents, cur)}</dd></div>}
          <div className="flex justify-between"><dt className="text-ink-soft">{settings.taxLabel}</dt><dd>{formatMoney(order.taxCents, cur)}</dd></div>
          <div className="flex justify-between border-t border-line pt-3 text-base font-medium"><dt>Total</dt><dd>{formatMoney(order.totalCents, cur)}</dd></div>
          {order.amountPaidCents > 0 && <div className="flex justify-between text-ink-soft"><dt>Paid</dt><dd>{formatMoney(order.amountPaidCents, cur)}</dd></div>}
          {order.amountRefundedCents > 0 && <div className="flex justify-between text-ink-soft"><dt>Refunded</dt><dd>{formatMoney(order.amountRefundedCents, cur)}</dd></div>}
        </dl>
        {order.payments.some((p) => p.status === "succeeded") && (
          <ul className="mt-4 border-t border-line pt-4 text-xs text-ink-muted">
            {order.payments
              .filter((p) => p.status === "succeeded")
              .map((p) => (
                <li key={p.id}>
                  {p.kind === "deposit" ? "Deposit" : p.kind === "balance" ? "Balance" : "Payment"} of {formatMoney(p.amountCents, cur)}
                  {p.succeededAt && ` on ${formatDate(p.succeededAt.toISOString().slice(0, 10))}`}
                </li>
              ))}
          </ul>
        )}
      </div>
      <p className="mt-6 text-sm text-ink-muted">Keep this page&apos;s link to check your order later. Lost it? Use <a className="underline" href="/orders/find">Find my orders</a>.</p>
      <div className="mt-8 flex gap-3">
        <ButtonLink href={cancelled && !fromQuote ? "/cart" : "/shop"} variant="secondary">{cancelled && !fromQuote ? "Back to cart" : "Continue browsing"}</ButtonLink>
      </div>
    </Container>
  );
}
