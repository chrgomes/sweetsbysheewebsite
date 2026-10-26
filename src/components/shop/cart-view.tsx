"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { lineKey } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import { cart, useCart } from "./cart-store";
import { ProductImage } from "./product-image";
import { useQuote } from "./use-quote";

export function CartView({ checkoutOpen }: { checkoutOpen: boolean }) {
  const lines = useCart();
  const { quote, loading } = useQuote(lines);

  if (!lines.length) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-paper px-6 py-16 text-center">
        <p className="font-display text-2xl text-ink">Your cart is empty.</p>
        <ButtonLink href="/shop" className="mt-6">Browse the menu</ButtonLink>
      </div>
    );
  }

  const priced = new Map(quote?.lines.map((l) => [l.key, l]));
  const errors = new Map(quote?.errors.map((e) => [e.key, e]));

  return (
    <div className="grid gap-10 lg:grid-cols-12">
      <ul className="divide-y divide-line border-y border-line lg:col-span-8" aria-busy={loading}>
        {lines.map((line, index) => {
          const key = lineKey(line.productId, line.optionValueIds, line.texts);
          const p = priced.get(key);
          const err = errors.get(key);
          return (
            <li key={key} className="flex gap-4 py-6 sm:gap-6">
              <div className="w-24 shrink-0 sm:w-28">
                <ProductImage src={p?.image?.src} alt={p?.image?.alt ?? ""} name={p?.name ?? "Item"} aspect="aspect-square" sizes="112px" className="rounded-xl" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    {p ? (
                      <Link href={`/products/${p.slug}`} className="font-display text-xl text-ink hover:text-berry">
                        {p.name}
                      </Link>
                    ) : (
                      <p className="font-display text-xl text-ink-muted">{loading ? "Loading…" : "Unavailable item"}</p>
                    )}
                    {p && p.options.length > 0 && <p className="mt-1 text-sm text-ink-soft">{p.options.map((o) => `${o.option}: ${o.value}`).join(" · ")}</p>}
                  </div>
                  {p && <p className="font-medium text-ink">{formatMoney(p.lineTotalCents, quote!.currency)}</p>}
                </div>
                {err && <p className="text-sm text-danger" role="alert">{err.message}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-4">
                  <div className="flex items-center rounded-full border border-line-strong bg-paper" role="group" aria-label={`Quantity for ${p?.name ?? "item"}`}>
                    <button type="button" className="size-10 rounded-full text-lg hover:bg-blush/60" onClick={() => cart.setQuantity(index, line.quantity - 1)} aria-label="Decrease quantity">−</button>
                    <span className="w-8 text-center tabular-nums" aria-live="polite">{line.quantity}</span>
                    <button type="button" className="size-10 rounded-full text-lg hover:bg-blush/60" onClick={() => cart.setQuantity(index, line.quantity + 1)} aria-label="Increase quantity">+</button>
                  </div>
                  <button type="button" className="text-sm text-ink-soft underline underline-offset-4 hover:text-danger" onClick={() => cart.remove(index)}>
                    Remove<span className="sr-only"> {p?.name}</span>
                  </button>
                  {p && line.quantity > 1 && <span className="text-sm text-ink-muted">{formatMoney(p.unitPriceCents, quote!.currency)} each</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <aside className="lg:col-span-4" aria-labelledby="summary-heading">
        <div className="rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)] lg:sticky lg:top-28">
          <h2 id="summary-heading" className="text-2xl text-ink">Summary</h2>
          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Subtotal</dt>
              <dd className="font-medium text-ink" aria-live="polite">{quote ? formatMoney(quote.subtotalCents, quote.currency) : "—"}</dd>
            </div>
            <div className="flex justify-between text-ink-muted">
              <dt>Tax & delivery</dt>
              <dd>Calculated at checkout</dd>
            </div>
          </dl>
          {quote?.errors.length ? (
            <div className="mt-6"><FormAlert>Please remove unavailable items before checking out.</FormAlert></div>
          ) : null}
          {checkoutOpen ? (
            <ButtonLink href="/checkout" size="lg" className="mt-6 w-full" aria-disabled={!quote || quote.errors.length > 0 || !quote.lines.length} onClick={(e) => { if (!quote || quote.errors.length || !quote.lines.length) e.preventDefault(); }}>
              Continue to checkout
            </ButtonLink>
          ) : (
            <div className="mt-6"><FormAlert tone="info">Online checkout isn&apos;t available yet. Please <Link className="underline" href="/contact">contact us</Link> to place your order.</FormAlert></div>
          )}
        </div>
      </aside>
    </div>
  );
}
