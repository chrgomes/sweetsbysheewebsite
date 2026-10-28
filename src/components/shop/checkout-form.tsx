"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { checkoutAction, type CheckoutState } from "@/app/actions/cart";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, FormAlert, Input, Select, Textarea } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { orderTotals } from "@/lib/pricing";
import { useCart } from "./cart-store";
import { useQuote } from "./use-quote";

export type CheckoutConfig = {
  taxRateBps: number;
  taxLabel: string;
  deliveryFeeCents: number | null;
  deliveryArea: string | null;
  pickupInstructions: string | null;
  maxDate: string;
  windows: string[];
};

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

export function CheckoutForm({ config, cancelledRef }: { config: CheckoutConfig; cancelledRef?: string }) {
  const lines = useCart();
  const [state, action, pending] = useActionState<CheckoutState, FormData>(checkoutAction, {});
  const v = state.values ?? {};
  const [codeInput, setCodeInput] = useState(v.discountCode ?? "");
  const [appliedCode, setAppliedCode] = useState<string | null>(v.discountCode || null);
  const { quote, loading } = useQuote(lines, appliedCode);
  const [method, setMethod] = useState<"pickup" | "delivery" | null>(null);
  // Controlled so the choice survives React's form reset after a failed submit (selects ignore defaultValue updates).
  const [timeWindow, setTimeWindow] = useState("");
  const e = state.fieldErrors ?? {};

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
  const discountOk = quote.discount && "amountCents" in quote.discount ? quote.discount : null;
  const discountError = quote.discount && "error" in quote.discount ? quote.discount.error : (e.discountCode ?? null);
  const totals = orderTotals({
    subtotalCents: quote.subtotalCents,
    discountCents: discountOk?.amountCents ?? 0,
    deliveryFeeCents: chosen === "delivery" ? (config.deliveryFeeCents ?? 0) : 0,
    taxRateBps: config.taxRateBps,
  });
  const cur = quote.currency;

  return (
    <form action={action} className="grid gap-10 lg:grid-cols-12" noValidate>
      <input type="hidden" name="cart" value={JSON.stringify(lines)} />
      <input type="hidden" name="discountCode" value={discountOk?.code ?? ""} />
      <div className="space-y-10 lg:col-span-7">
        {cancelledRef && <FormAlert tone="info">Payment was cancelled. Your cart is still here whenever you&apos;re ready.</FormAlert>}
        {state.message && <FormAlert id="checkout-error">{state.message}</FormAlert>}
        {state.lineErrors?.map((l) => <FormAlert key={l.key}>{l.message}</FormAlert>)}

        <fieldset className="space-y-5">
          <legend className="font-display text-2xl text-ink">Your details</legend>
          <Field id="customerName" label="Full name" required error={e.customerName}>
            <Input id="customerName" autoComplete="name" required defaultValue={v.customerName} error={e.customerName} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="customerEmail" label="Email" required error={e.customerEmail} hint="For your receipt and order updates.">
              <Input id="customerEmail" type="email" autoComplete="email" required defaultValue={v.customerEmail} error={e.customerEmail} hasHint />
            </Field>
            <Field id="customerPhone" label="Phone" error={e.customerPhone}>
              <Input id="customerPhone" type="tel" autoComplete="tel" defaultValue={v.customerPhone} error={e.customerPhone} />
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

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="fulfillmentDate"
              label={chosen === "delivery" ? "Delivery date" : "Pickup date"}
              required
              error={e.fulfillmentDate}
              hint={quote.earliestDate ? `Earliest available: ${fmtDay(quote.earliestDate)}.` : "No dates are available right now — please contact us."}
            >
              <Input id="fulfillmentDate" type="date" required min={quote.earliestDate ?? undefined} max={config.maxDate} defaultValue={v.fulfillmentDate} error={e.fulfillmentDate} hasHint />
            </Field>
            {config.windows.length > 0 && (
              <Field id="fulfillmentWindow" label="Time" required error={e.fulfillmentWindow}>
                <Select id="fulfillmentWindow" required value={timeWindow} onChange={(ev) => setTimeWindow(ev.target.value)} error={e.fulfillmentWindow}>
                  <option value="" disabled>Choose a time</option>
                  {config.windows.map((w) => <option key={w}>{w}</option>)}
                </Select>
              </Field>
            )}
          </div>
          {quote.fullDates.length > 0 && (
            <p className="text-sm text-ink-muted">Fully booked: {quote.fullDates.map((d) => fmtDay(d, { month: "short", day: "numeric" })).join(", ")}.</p>
          )}

          {chosen === "delivery" && (
            <div className="space-y-5 rounded-2xl border border-line bg-paper p-5">
              <Field id="line1" label="Street address" required error={e.line1}>
                <Input id="line1" autoComplete="address-line1" required defaultValue={v.line1} error={e.line1} />
              </Field>
              <Field id="line2" label="Apartment, suite, etc." error={e.line2}>
                <Input id="line2" autoComplete="address-line2" defaultValue={v.line2} error={e.line2} />
              </Field>
              <div className="grid gap-5 sm:grid-cols-3">
                <Field id="city" label="City" required error={e.city}><Input id="city" autoComplete="address-level2" required defaultValue={v.city} error={e.city} /></Field>
                <Field id="region" label="State" required error={e.region}><Input id="region" autoComplete="address-level1" required defaultValue={v.region} error={e.region} /></Field>
                <Field id="postalCode" label="ZIP code" required error={e.postalCode}><Input id="postalCode" autoComplete="postal-code" inputMode="numeric" required defaultValue={v.postalCode} error={e.postalCode} /></Field>
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

          <div className="mt-4 border-t border-line pt-4">
            <label htmlFor="discount-input" className="text-sm font-medium text-ink">Discount code</label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="discount-input"
                value={codeInput}
                onChange={(ev) => setCodeInput(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    setAppliedCode(codeInput.trim() || null);
                  }
                }}
                autoComplete="off"
                aria-describedby="discount-status"
                aria-invalid={discountError ? true : undefined}
                className="min-w-0 flex-1 rounded-xl border border-line-strong bg-white px-3 py-2 text-sm uppercase focus:border-ink focus:outline-none"
              />
              <Button type="button" variant="secondary" size="sm" onClick={() => setAppliedCode(codeInput.trim() || null)}>Apply</Button>
            </div>
            <p id="discount-status" aria-live="polite" className={cn("mt-1.5 text-sm", discountError ? "text-danger" : "text-sage")}>
              {discountError ?? (discountOk ? `Code ${discountOk.code} applied.` : "")}
            </p>
          </div>

          <dl className="mt-2 space-y-2 border-t border-line pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-ink-soft">Subtotal</dt><dd>{formatMoney(totals.subtotalCents, cur)}</dd></div>
            {totals.discountCents > 0 && <div className="flex justify-between text-sage"><dt>Discount ({discountOk?.code})</dt><dd>−{formatMoney(totals.discountCents, cur)}</dd></div>}
            {chosen === "delivery" && <div className="flex justify-between"><dt className="text-ink-soft">Delivery</dt><dd>{formatMoney(totals.deliveryFeeCents, cur)}</dd></div>}
            <div className="flex justify-between"><dt className="text-ink-soft">{config.taxLabel}</dt><dd>{formatMoney(totals.taxCents, cur)}</dd></div>
            <div className="flex justify-between border-t border-line pt-3 text-base font-medium"><dt>Total</dt><dd aria-live="polite">{formatMoney(totals.totalCents, cur)}</dd></div>
          </dl>
          <Button type="submit" size="lg" className="mt-6 w-full" disabled={pending || methods.length === 0 || !quote.earliestDate}>
            {pending ? "Starting secure payment…" : "Continue to payment"}
          </Button>
          <p className="mt-3 text-center text-xs text-ink-muted">You&apos;ll complete payment on our payment provider&apos;s secure page. Your order is confirmed once payment succeeds; the final amount is checked again before you pay.</p>
        </div>
      </aside>
    </form>
  );
}
