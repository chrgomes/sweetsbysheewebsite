import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { acceptQuoteAction, declineQuoteAction } from "@/app/actions/customer";
import { SimpleActionForm } from "@/components/site/simple-action-form";
import { Container, Eyebrow } from "@/components/ui/container";
import { FormAlert } from "@/components/ui/field";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { paymentProvider } from "@/lib/payments";
import { getQuoteForCustomer } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Your quote", robots: { index: false, follow: false } };

export default async function QuotePage({ params, searchParams }: PageProps<"/quotes/[reference]">) {
  const { reference } = await params;
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : undefined;
  const quote = await getQuoteForCustomer(reference, token);
  if (!quote) notFound();
  const s = await getSettings();
  const cur = quote.currency;
  const expired = quote.status === "expired" || (quote.status === "sent" && quote.expiresAt !== null && quote.expiresAt < new Date());
  const open = quote.status === "sent" && !expired;
  const online = paymentProvider() !== null;

  return (
    <Container size="narrow" className="py-12 lg:py-20">
      <Eyebrow>Quote {quote.reference} · request {quote.inquiry.reference}</Eyebrow>
      <h1 className="mt-3 text-4xl font-light text-ink sm:text-5xl">Your quote from {s.businessName}</h1>

      <div className="mt-6" role="status">
        {quote.status === "accepted" && (
          <FormAlert tone="success">
            You accepted this quote.{" "}
            {quote.order && (
              <Link className="font-medium underline" href={quote.order.link}>
                View your order {quote.order.reference}
              </Link>
            )}
          </FormAlert>
        )}
        {quote.status === "declined" && <FormAlert tone="info">You declined this quote. Thanks for letting us know.</FormAlert>}
        {quote.status === "withdrawn" && <FormAlert tone="info">This quote has been replaced or withdrawn. Please use the most recent quote we sent you.</FormAlert>}
        {expired && <FormAlert>This quote has expired, so the date isn&apos;t held. Contact us if you&apos;d still like to go ahead.</FormAlert>}
        {open && quote.expiresAt && <p className="text-ink-soft">This quote is valid until {formatDate(quote.expiresAt.toISOString().slice(0, 10))}.</p>}
      </div>

      <div className="mt-8 rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <h2 className="text-2xl text-ink">{quote.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"} on {formatDate(quote.fulfillmentDate)}</h2>
        <ul className="mt-6 divide-y divide-line border-y border-line text-sm">
          {quote.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-4 py-3">
              <span>{l.quantity} × {l.description}</span>
              <span>{formatMoney(l.lineTotalCents, cur)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-ink-soft">Subtotal</dt><dd>{formatMoney(quote.subtotalCents, cur)}</dd></div>
          {quote.deliveryFeeCents > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Delivery</dt><dd>{formatMoney(quote.deliveryFeeCents, cur)}</dd></div>}
          <div className="flex justify-between"><dt className="text-ink-soft">{s.taxLabel}</dt><dd>{formatMoney(quote.taxCents, cur)}</dd></div>
          <div className="flex justify-between border-t border-line pt-3 text-base font-medium"><dt>Total</dt><dd>{formatMoney(quote.totalCents, cur)}</dd></div>
          {quote.depositCents > 0 && <div className="flex justify-between text-ink-soft"><dt>Deposit to confirm</dt><dd>{formatMoney(quote.depositCents, cur)}</dd></div>}
        </dl>
        {quote.customerMessage && <p className="mt-6 rounded-xl bg-cream p-4 text-sm whitespace-pre-line text-ink">{quote.customerMessage}</p>}
      </div>

      {open && (
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <section aria-labelledby="accept-heading" className="rounded-2xl border border-line bg-paper p-6">
            <h2 id="accept-heading" className="text-xl text-ink">Accept</h2>
            <p className="mt-2 text-sm text-ink-soft">
              {online
                ? `You'll be taken to our secure payment page to pay ${quote.depositCents > 0 ? `the ${formatMoney(quote.depositCents, cur)} deposit` : `${formatMoney(quote.totalCents, cur)}`}. Your date is booked once payment succeeds.`
                : "We'll be in touch to arrange payment. Your date is booked once payment is received."}
            </p>
            <SimpleActionForm action={acceptQuoteAction} hidden={{ reference: quote.reference, t: token! }} submitLabel="Accept quote" pendingLabel="Accepting…" className="mt-4 space-y-4">
              <label className="flex items-start gap-3 text-sm text-ink">
                <input type="checkbox" name="agree" required className="mt-0.5 size-5 shrink-0 accent-[var(--berry)]" />
                <span>I&apos;ve reviewed the quote and the details above are correct.</span>
              </label>
            </SimpleActionForm>
          </section>
          <section aria-labelledby="decline-heading" className="rounded-2xl border border-line p-6">
            <h2 id="decline-heading" className="text-xl text-ink">Decline</h2>
            <SimpleActionForm action={declineQuoteAction} hidden={{ reference: quote.reference, t: token! }} submitLabel="Decline quote" variant="secondary" className="mt-4 space-y-4">
              <label htmlFor="reason" className="block text-sm text-ink">Anything you&apos;d like us to know? <span className="text-ink-muted">(optional)</span></label>
              <textarea id="reason" name="reason" rows={3} maxLength={1000} className="block w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-sm focus:border-ink focus:outline-none" />
            </SimpleActionForm>
          </section>
        </div>
      )}
    </Container>
  );
}
