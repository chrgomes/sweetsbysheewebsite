"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { checkoutAction, type CheckoutState } from "@/app/actions/cart";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, FormAlert, Input, Textarea } from "@/components/ui/field";
import { formatMoney, taxFor } from "@/lib/money";
import { useCart } from "./cart-store";
import { useQuote } from "./use-quote";

export type CheckoutConfig = {
  taxRateBps: number;
  taxLabel: string;
  deliveryFeeCents: number | null;
  deliveryArea: string | null;
  pickupInstructions: string | null;
  maxDate: string;
  automaticTax: boolean;
};

export function CheckoutForm({ config, cancelledRef }: { config: CheckoutConfig; cancelledRef?: string }) {
  const lines = useCart();
  const { quote, loading } = useQuote(lines);
  const [state, action, pending] = useActionState<CheckoutState, FormData>(checkoutAction, {});
  const [method, setMethod] = useState<"pickup" | "delivery" | null>(null);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};

  if (!lines.length) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-paper px-6 py-16 text-center">
        <p className="font-display text-2xl text-ink">Your cart is empty.</p>
        <ButtonLink href="/shop" className="mt-6">Browse the menu</ButtonLink>
      </div>
    );
  }
  if (loading && !quote) return <p className="text-ink-soft" role="status">Loading your order…</p>;
  if (!quote) return <FormAlert>We couldn&apos;t load your cart. Please refresh the page.</FormAlert>;
  if (quote.errors.length) {
    return (
      <FormAlert>
        Some items in your cart are no longer available. <Link href="/cart" className="font-medium underline">Review your cart</Link>.
      </FormAlert>
    );
  }

  const methods = [quote.pickupAvailable && "pickup", quote.deliveryAvailable && "delivery"].filter(Boolean) as ("pickup" | "delivery")[];
  const chosen = method ?? (methods.length === 1 ? methods[0] : null);
  const delivery = chosen === "delivery" ? (config.deliveryFeeCents ?? 0) : 0;
  const tax = config.automaticTax ? null : taxFor(quote.subtotalCents + delivery, config.taxRateBps);
  const cur = quote.currency;

  return (
    <form action={action} className="grid gap-10 lg:grid-cols-12" noValidate>
      <input type="hidden" name="cart" value={JSON.stringify(lines)} />
      <div className="space-y-10 lg:col-span-7">
        {cancelledRef && <FormAlert tone="info">Payment was cancelled. Your cart is still here whenever you&apos;re ready.</FormAlert>}
        {state.message && <FormAlert id="checkout-error">{state.message}</FormAlert>}
        {state.lineErrors?.map((l) => <FormAlert key={l.key}>{l.message}</FormAlert>)}

        <fieldset className="space-y-5">
          <legend className="font-display text-2xl text-ink">Your details</legend>
          <Field id="customerName" label="Full name" required error={e.customerName}>
            <Input id="customerName" defaultValue={v.customerName} autoComplete="name" required error={e.customerName} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="customerEmail" label="Email" required error={e.customerEmail} hint="For your receipt and order updates.">
              <Input id="customerEmail" defaultValue={v.customerEmail} type="email" autoComplete="email" required error={e.customerEmail} hasHint />
            </Field>
            <Field id="customerPhone" label="Phone" error={e.customerPhone}>
              <Input id="customerPhone" defaultValue={v.customerPhone} type="tel" autoComplete="tel" error={e.customerPhone} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-5">
          <legend className="font-display text-2xl text-ink">Pickup or delivery</legend>
          {methods.length === 0 ? (
            <FormAlert>These items can&apos;t be collected or delivered together. Please contact us to arrange your order.</FormAlert>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Fulfilment method" aria-describedby={e.fulfillmentMethod ? "fm-error" : undefined}>
              {methods.map((m) => (
                <label key={m} className={cn("flex cursor-pointer flex-col rounded-2xl border p-5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]", chosen === m ? "border-ink bg-paper" : "border-line-strong hover:border-ink-muted")}>
                  <input type="radio" name="fulfillmentMethod" value={m} checked={chosen === m} onChange={() => setMethod(m)} className="sr-only" />
                  <span className="font-medium text-ink">{m === "pickup" ? "Pickup" : "Delivery"}</span>
                  <span className="mt-1 text-sm text-ink-soft">
                    {m === "pickup" ? (config.pickupInstructions ?? "Collect your order on your chosen date.") : `${config.deliveryFeeCents ? formatMoney(config.deliveryFeeCents, cur) : "Free"}${config.deliveryArea ? ` · ${config.deliveryArea}` : ""}`}
                  </span>
                </label>
              ))}
            </div>
          )}
          {e.fulfillmentMethod && <p id="fm-error" className="text-sm font-medium text-danger">{e.fulfillmentMethod}</p>}

          <Field id="fulfillmentDate" label={chosen === "delivery" ? "Delivery date" : "Pickup date"} required error={e.fulfillmentDate} hint={quote.earliestDate ? `The earliest available date for this order is ${new Date(`${quote.earliestDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}.` : undefined}>
            <Input id="fulfillmentDate" defaultValue={v.fulfillmentDate} type="date" required min={quote.earliestDate ?? undefined} max={config.maxDate} error={e.fulfillmentDate} hasHint={!!quote.earliestDate} className="sm:max-w-xs" />
          </Field>

          {chosen === "delivery" && (
            <div className="space-y-5 rounded-2xl border border-line bg-paper p-5">
              <Field id="line1" label="Street address" required error={e.line1}>
                <Input id="line1" defaultValue={v.line1} autoComplete="address-line1" required error={e.line1} />
              </Field>
              <Field id="line2" label="Apartment, suite, etc." error={e.line2}>
                <Input id="line2" defaultValue={v.line2} autoComplete="address-line2" error={e.line2} />
              </Field>
              <div className="grid gap-5 sm:grid-cols-3">
                <Field id="city" label="City" required error={e.city}><Input id="city" defaultValue={v.city} autoComplete="address-level2" required error={e.city} /></Field>
                <Field id="region" label="State" required error={e.region}><Input id="region" defaultValue={v.region} autoComplete="address-level1" required error={e.region} /></Field>
                <Field id="postalCode" label="ZIP code" required error={e.postalCode}><Input id="postalCode" defaultValue={v.postalCode} autoComplete="postal-code" inputMode="numeric" required error={e.postalCode} /></Field>
              </div>
            </div>
          )}

          <Field id="notes" label="Notes for the bakery" error={e.notes} hint="Anything we should know? For allergies, please contact us before ordering.">
            <Textarea id="notes" rows={3} defaultValue={v.notes} error={e.notes} hasHint />
          </Field>
        </fieldset>
      </div>

      <aside className="lg:col-span-5" aria-labelledby="order-summary">
        <div className="rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)] lg:sticky lg:top-28">
          <h2 id="order-summary" className="text-2xl text-ink">Order summary</h2>
          <ul className="mt-6 divide-y divide-line text-sm">
            {quote.lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-4 py-3">
                <span>
                  <span className="text-ink">{l.quantity} × {l.name}</span>
                  {l.options.length > 0 && <span className="block text-ink-muted">{l.options.map((o) => o.value).join(" · ")}</span>}
                </span>
                <span className="text-ink">{formatMoney(l.lineTotalCents, cur)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-ink-soft">Subtotal</dt><dd>{formatMoney(quote.subtotalCents, cur)}</dd></div>
            {chosen === "delivery" && <div className="flex justify-between"><dt className="text-ink-soft">Delivery</dt><dd>{formatMoney(delivery, cur)}</dd></div>}
            <div className="flex justify-between"><dt className="text-ink-soft">{config.taxLabel}</dt><dd>{tax === null ? "Calculated at payment" : formatMoney(tax, cur)}</dd></div>
            <div className="flex justify-between border-t border-line pt-3 text-base font-medium"><dt>Total</dt><dd>{formatMoney(quote.subtotalCents + delivery + (tax ?? 0), cur)}</dd></div>
          </dl>
          <Button type="submit" size="lg" className="mt-6 w-full" disabled={pending || methods.length === 0}>
            {pending ? "Starting secure payment…" : "Continue to payment"}
          </Button>
          <p className="mt-3 text-center text-xs text-ink-muted">You&apos;ll complete payment on our payment provider&apos;s secure page. Your order is confirmed once payment succeeds.</p>
        </div>
      </aside>
    </form>
  );
}
