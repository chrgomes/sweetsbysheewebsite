"use client";

import { useState } from "react";
import { saveQuoteAction } from "@/app/admin/actions/inquiries";
import { AdminForm } from "@/components/admin/admin-form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

export type QuoteEditorValues = {
  fulfillmentMethod: "pickup" | "delivery";
  fulfillmentDate: string;
  lines: { description: string; quantity: number; price: string }[];
  deliveryFee: string;
  deposit: string;
  capacityUnits: number;
  customerMessage: string;
};

/** Line-item quote builder. Totals shown here are a preview; the server recalculates on save. */
export function QuoteEditor({ inquiryId, initial, taxRateBps, defaultDepositBps, currency }: { inquiryId: string; initial: QuoteEditorValues; taxRateBps: number | null; defaultDepositBps: number | null; currency: string }) {
  const [rows, setRows] = useState(() => initial.lines.map((l, i) => ({ ...l, key: i })));
  const [method, setMethod] = useState(initial.fulfillmentMethod);
  const [deliveryFee, setDeliveryFee] = useState(initial.deliveryFee);
  const [nextKey, setNextKey] = useState(initial.lines.length);

  const cents = (s: string) => {
    const n = Number(s.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };
  const subtotal = rows.reduce((n, r) => n + cents(r.price) * (r.quantity || 0), 0);
  const fee = method === "delivery" ? cents(deliveryFee) : 0;
  const tax = taxRateBps === null ? null : Math.round(((subtotal + fee) * taxRateBps) / 10_000);
  const total = subtotal + fee + (tax ?? 0);
  const fmt = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(c / 100);

  function update(key: number, patch: Partial<(typeof rows)[number]>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <AdminForm action={saveQuoteAction} submitLabel="Save draft">
      {(st) => (
        <>
          <input type="hidden" name="inquiryId" value={inquiryId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="q-method" label="Fulfilment" required>
              <Select id="q-method" name="fulfillmentMethod" value={method} onChange={(e) => setMethod(e.target.value as "pickup" | "delivery")}>
                <option value="pickup">Pickup</option>
                <option value="delivery">Delivery</option>
              </Select>
            </Field>
            <Field id="q-date" label="Date" required error={st.errors?.fulfillmentDate}>
              <Input id="q-date" name="fulfillmentDate" type="date" defaultValue={initial.fulfillmentDate} required error={st.errors?.fulfillmentDate} />
            </Field>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink">Line items</legend>
            <div aria-hidden="true" className="grid grid-cols-[1fr_4.5rem_6.5rem_2.75rem] gap-2 text-xs text-ink-muted">
              <span>Description</span>
              <span>Qty</span>
              <span>Unit price</span>
            </div>
            {rows.map((r, i) => (
              <div key={r.key}>
                <div className="grid grid-cols-[1fr_4.5rem_6.5rem_2.75rem] items-center gap-2">
                  <Input id={`l-desc-${r.key}`} aria-label={`Line ${i + 1} description`} name="lineDescription" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} maxLength={300} />
                  <Input id={`l-qty-${r.key}`} aria-label={`Line ${i + 1} quantity`} name="lineQuantity" type="number" min={1} max={999} value={r.quantity} onChange={(e) => update(r.key, { quantity: Number(e.target.value) })} />
                  <Input id={`l-price-${r.key}`} aria-label={`Line ${i + 1} unit price`} name="linePrice" inputMode="decimal" placeholder="0.00" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} error={st.errors?.[`line${i}`]} />
                  <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={rows.length === 1} className="min-h-11 rounded-full text-sm text-ink-muted hover:text-danger disabled:opacity-30" aria-label={`Remove line ${i + 1}`}>
                    ✕
                  </button>
                </div>
                {st.errors?.[`line${i}`] && <p id={`l-price-${r.key}-error`} className="mt-1 text-sm font-medium text-danger">{st.errors[`line${i}`]}</p>}
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                setRows((rs) => [...rs, { description: "", quantity: 1, price: "", key: nextKey }]);
                setNextKey((k) => k + 1);
              }}
              className="text-sm font-medium text-berry hover:underline"
            >
              + Add line
            </button>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            {method === "delivery" && (
              <Field id="q-fee" label="Delivery fee" error={st.errors?.deliveryFee}>
                <Input id="q-fee" name="deliveryFee" inputMode="decimal" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} error={st.errors?.deliveryFee} />
              </Field>
            )}
            <Field id="q-deposit" label="Deposit" hint={defaultDepositBps === null ? "Blank = full payment up front" : `Blank = ${defaultDepositBps / 100}% default`} error={st.errors?.deposit}>
              <Input id="q-deposit" name="deposit" inputMode="decimal" defaultValue={initial.deposit} hasHint error={st.errors?.deposit} />
            </Field>
            <Field id="q-units" label="Capacity units" hint="Production slots this order uses">
              <Input id="q-units" name="capacityUnits" type="number" min={0} max={1000} defaultValue={initial.capacityUnits} hasHint />
            </Field>
          </div>

          <Field id="q-message" label="Message to the customer" hint="Shown on the quote. Plain text.">
            <Textarea id="q-message" name="customerMessage" rows={3} maxLength={2000} defaultValue={initial.customerMessage} hasHint />
          </Field>

          <dl className="rounded-xl bg-cream p-4 text-sm" aria-live="polite">
            <div className="flex justify-between"><dt className="text-ink-soft">Subtotal</dt><dd className="tabular-nums">{fmt(subtotal)}</dd></div>
            {fee > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Delivery</dt><dd className="tabular-nums">{fmt(fee)}</dd></div>}
            <div className="flex justify-between"><dt className="text-ink-soft">Tax</dt><dd className="tabular-nums">{tax === null ? "Set a tax rate in Settings" : fmt(tax)}</dd></div>
            <div className="mt-2 flex justify-between border-t border-line pt-2 font-medium"><dt>Total (preview)</dt><dd className="tabular-nums">{fmt(total)}</dd></div>
          </dl>
        </>
      )}
    </AdminForm>
  );
}
