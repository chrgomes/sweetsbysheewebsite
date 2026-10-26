"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { formatMoney } from "@/lib/money";
import { cart } from "./cart-store";

export type PurchaseOption = {
  id: string;
  name: string;
  kind: "choice" | "text";
  required: boolean;
  maxLength: number | null;
  priceDeltaCents: number;
  helpText: string | null;
  values: { id: string; label: string; priceDeltaCents: number; available: boolean }[];
};

/**
 * Option picker + quantity + add to cart. The price shown here is a preview;
 * the server re-prices everything in the cart and at checkout.
 */
export function AddToCart({
  productId,
  basePriceCents,
  currency,
  options,
  maxQuantity,
}: {
  productId: string;
  basePriceCents: number;
  currency: string;
  options: PurchaseOption[];
  maxQuantity: number;
}) {
  const uid = useId();
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    // Preselect a required option only when it has exactly one available choice.
    const init: Record<string, string> = {};
    for (const o of options) {
      const avail = o.values.filter((v) => v.available);
      if (o.required && avail.length === 1) init[o.id] = avail[0].id;
    }
    return init;
  });
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const unit = useMemo(
    () =>
      basePriceCents +
      options.reduce(
        (sum, o) => sum + (o.kind === "text" ? (texts[o.id]?.trim() ? o.priceDeltaCents : 0) : (o.values.find((v) => v.id === selected[o.id])?.priceDeltaCents ?? 0)),
        0,
      ),
    [basePriceCents, options, selected, texts],
  );
  const missing = options.filter((o) => o.required && (o.kind === "text" ? !texts[o.id]?.trim() : !selected[o.id]));

  function add() {
    if (missing.length) {
      const choices = missing.filter((o) => o.kind !== "text").map((o) => `a ${o.name.toLowerCase()}`);
      const texts = missing.filter((o) => o.kind === "text").map((o) => `"${o.name}"`);
      const parts = [choices.length && `choose ${choices.join(" and ")}`, texts.length && `fill in ${texts.join(" and ")}`].filter(Boolean);
      setStatus({ tone: "error", text: `Please ${parts.join(" and ")}.` });
      return;
    }
    const filled = options.filter((o) => o.kind === "text" && texts[o.id]?.trim()).map((o) => ({ optionId: o.id, value: texts[o.id].replace(/\s+/g, " ").trim() }));
    cart.add({ productId, optionValueIds: Object.values(selected).filter(Boolean), texts: filled.length ? filled : undefined, quantity });
    setStatus({ tone: "ok", text: `Added ${quantity} to your cart.` });
  }

  return (
    <div className="space-y-7">
      <p className="text-3xl text-ink" aria-live="polite">
        {formatMoney(unit, currency)}
        {quantity > 1 && <span className="ml-2 text-base text-ink-muted">× {quantity} = {formatMoney(unit * quantity, currency)}</span>}
      </p>

      {options.map((o) =>
        o.kind === "text" ? (
          <div key={o.id} className="space-y-1.5">
            <label htmlFor={`${uid}-${o.id}`} className="block text-sm font-medium text-ink">
              {o.name}
              {!o.required && <span className="font-normal text-ink-muted"> (optional)</span>}
              {o.priceDeltaCents > 0 && <span className="font-normal text-ink-muted"> +{formatMoney(o.priceDeltaCents, currency)}</span>}
            </label>
            {o.helpText && <p id={`${uid}-${o.id}-hint`} className="text-sm text-ink-muted">{o.helpText}</p>}
            <input
              id={`${uid}-${o.id}`}
              type="text"
              value={texts[o.id] ?? ""}
              maxLength={o.maxLength ?? 500}
              onChange={(e) => {
                setTexts((t) => ({ ...t, [o.id]: e.target.value }));
                setStatus(null);
              }}
              aria-describedby={[o.helpText ? `${uid}-${o.id}-hint` : "", `${uid}-${o.id}-count`].filter(Boolean).join(" ")}
              className="block w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-[0.95rem] text-ink focus:border-ink focus:outline-none"
            />
            <p id={`${uid}-${o.id}-count`} className="text-right text-xs text-ink-muted">
              {(texts[o.id] ?? "").length}/{o.maxLength ?? 500}
            </p>
          </div>
        ) : (
        <fieldset key={o.id}>
          <legend className="mb-3 text-sm font-medium text-ink">
            {o.name}
            {!o.required && <span className="font-normal text-ink-muted"> (optional)</span>}
          </legend>
          <div className="flex flex-wrap gap-2">
            {!o.required && (
              <label className={cn("cursor-pointer rounded-full border px-4 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]", !selected[o.id] ? "border-ink bg-ink text-cream" : "border-line-strong bg-paper text-ink hover:border-ink")}>
                <input type="radio" className="sr-only" name={`${uid}-${o.id}`} checked={!selected[o.id]} onChange={() => setSelected((s) => ({ ...s, [o.id]: "" }))} />
                None
              </label>
            )}
            {o.values.map((v) => {
              const checked = selected[o.id] === v.id;
              return (
                <label
                  key={v.id}
                  className={cn(
                    "rounded-full border px-4 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]",
                    !v.available ? "cursor-not-allowed border-line text-ink-muted line-through" : "cursor-pointer",
                    checked ? "border-ink bg-ink text-cream" : v.available && "border-line-strong bg-paper text-ink hover:border-ink",
                  )}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={`${uid}-${o.id}`}
                    value={v.id}
                    checked={checked}
                    disabled={!v.available}
                    onChange={() => {
                      setSelected((s) => ({ ...s, [o.id]: v.id }));
                      setStatus(null);
                    }}
                  />
                  {v.label}
                  {v.priceDeltaCents !== 0 && <span className={checked ? "text-cream/80" : "text-ink-muted"}> {v.priceDeltaCents > 0 ? "+" : "−"}{formatMoney(Math.abs(v.priceDeltaCents), currency)}</span>}
                  {!v.available && <span className="sr-only"> (unavailable)</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
        ),
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div className="flex items-center rounded-full border border-line-strong bg-paper" role="group" aria-label="Quantity">
          <button type="button" className="size-12 rounded-full text-xl text-ink hover:bg-blush/60 disabled:opacity-40" onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1} aria-label="Decrease quantity">
            −
          </button>
          <label htmlFor={`${uid}-qty`} className="sr-only">Quantity</label>
          <input
            id={`${uid}-qty`}
            type="number"
            inputMode="numeric"
            min={1}
            max={maxQuantity}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.min(maxQuantity, Number(e.target.value) || 1)))}
            className="w-12 [appearance:textfield] bg-transparent text-center text-ink focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button type="button" className="size-12 rounded-full text-xl text-ink hover:bg-blush/60 disabled:opacity-40" onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))} disabled={quantity >= maxQuantity} aria-label="Increase quantity">
            +
          </button>
        </div>
        <Button size="lg" className="flex-1" onClick={add}>
          Add to cart
        </Button>
      </div>
      <div aria-live="polite" className="min-h-6 text-sm">
        {status && (
          <p className={status.tone === "ok" ? "text-sage" : "text-danger"}>
            {status.text}
            {status.tone === "ok" && (
              <>
                {" "}
                <Link href="/cart" className="font-medium underline underline-offset-4">
                  View cart
                </Link>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
