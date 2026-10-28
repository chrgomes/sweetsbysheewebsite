"use client";

import { setOverrideAction } from "@/app/admin/actions/calendar";
import { saveDiscountAction } from "@/app/admin/actions/discounts";
import { recordPaymentAction, refundAction } from "@/app/admin/actions/orders";
import { AdminForm } from "@/components/admin/admin-form";
import { Field, Input, Select } from "@/components/ui/field";

/* Admin forms that show per-field errors. They're client components because
   the error state lives in the client form; pages pass plain data. */

export function RefundForm({ orderId, paymentId, provider, refundableLabel, refundableInput }: { orderId: string; paymentId: string; provider: string; refundableLabel: string; refundableInput: string }) {
  return (
    <AdminForm action={refundAction} submitLabel="Issue refund" variant="danger" className="mt-4 space-y-4">
      {(st) => (
        <>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="paymentId" value={paymentId} />
          <Field id={`amount-${paymentId}`} label="Amount" required hint={`Up to ${refundableLabel}`} error={st.errors?.amount}>
            <Input id={`amount-${paymentId}`} name="amount" inputMode="decimal" defaultValue={refundableInput} hasHint error={st.errors?.amount} />
          </Field>
          <Field id={`reason-${paymentId}`} label="Reason" required>
            <Input id={`reason-${paymentId}`} name="reason" required maxLength={500} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirm" className="mt-0.5 size-4" aria-invalid={st.errors?.confirm ? true : undefined} />
            <span>{provider === "offline" ? "I've returned this money to the customer outside the website." : `Refund through ${provider}. This sends money back to the customer and can't be undone.`}</span>
          </label>
        </>
      )}
    </AdminForm>
  );
}

export function OfflinePaymentForm({ orderId, balanceLabel, balanceInput }: { orderId: string; balanceLabel: string; balanceInput: string }) {
  return (
    <AdminForm action={recordPaymentAction} submitLabel="Record payment" className="mt-4 space-y-4">
      {(st) => (
        <>
          <input type="hidden" name="orderId" value={orderId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pay-amount" label="Amount received" required hint={`Balance ${balanceLabel}`} error={st.errors?.amount}>
              <Input id="pay-amount" name="amount" inputMode="decimal" defaultValue={balanceInput} hasHint error={st.errors?.amount} />
            </Field>
            <Field id="pay-method" label="Method" required error={st.errors?.method}>
              <Input id="pay-method" name="method" placeholder="Cash, bank transfer…" error={st.errors?.method} />
            </Field>
          </div>
          <Field id="pay-note" label="Note" required error={st.errors?.note}>
            <Input id="pay-note" name="note" maxLength={500} placeholder="e.g. Paid in person at pickup" error={st.errors?.note} />
          </Field>
          <p className="text-xs text-ink-muted">Only record money you&apos;ve actually received. Recording a payment can confirm the order and emails the customer.</p>
        </>
      )}
    </AdminForm>
  );
}

export function CapacityOverrideForm({ date, units, hasOverride }: { date: string; units: number | ""; hasOverride: boolean }) {
  return (
    <AdminForm action={setOverrideAction} submitLabel="Save">
      {(st) => (
        <>
          <input type="hidden" name="date" value={date} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="capacityUnits" label="Units available" hint="0 closes the day to new orders." error={st.errors?.capacityUnits}>
              <Input id="capacityUnits" inputMode="numeric" defaultValue={units} hasHint error={st.errors?.capacityUnits} />
            </Field>
            <Field id="reason" label="Reason" required error={st.errors?.reason}>
              <Input id="reason" maxLength={300} placeholder="e.g. Wedding fair, staff holiday" error={st.errors?.reason} />
            </Field>
          </div>
          {hasOverride && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="clear" className="size-4" /> Remove the adjustment
            </label>
          )}
          <p className="text-xs text-ink-muted">Lowering capacity doesn&apos;t cancel orders already booked.</p>
        </>
      )}
    </AdminForm>
  );
}

export type DiscountFormValues = {
  id?: string;
  code: string;
  kind: "percent" | "fixed";
  value: string;
  minSubtotal: string;
  startsOn: string;
  endsOn: string;
  maxRedemptions: string;
  maxPerCustomer: string;
  description: string;
  active: boolean;
};

export function DiscountForm({ d }: { d?: DiscountFormValues }) {
  const p = d?.id ?? "new";
  return (
    <AdminForm action={saveDiscountAction} submitLabel={d ? "Save" : "Create code"} resetOnSuccess={!d} className="space-y-5">
      {(st) => {
        const e = st.errors ?? {};
        return (
          <>
            {d?.id && <input type="hidden" name="id" value={d.id} />}
            <div className="grid gap-4 md:grid-cols-4">
              <Field id={`code-${p}`} label="Code" required error={e.code}>
                <Input id={`code-${p}`} name="code" defaultValue={d?.code} className="uppercase" error={e.code} />
              </Field>
              <Field id={`kind-${p}`} label="Type">
                <Select id={`kind-${p}`} name="kind" defaultValue={d?.kind ?? "percent"}>
                  <option value="percent">Percentage off</option>
                  <option value="fixed">Fixed amount off</option>
                </Select>
              </Field>
              <Field id={`value-${p}`} label="Amount" required hint="% or $" error={e.value}>
                <Input id={`value-${p}`} name="value" inputMode="decimal" defaultValue={d?.value} hasHint error={e.value} />
              </Field>
              <Field id={`min-${p}`} label="Minimum order ($)" error={e.minSubtotalCents}>
                <Input id={`min-${p}`} name="minSubtotal" inputMode="decimal" defaultValue={d?.minSubtotal} error={e.minSubtotalCents} />
              </Field>
              <Field id={`starts-${p}`} label="Starts">
                <Input id={`starts-${p}`} name="startsOn" type="date" defaultValue={d?.startsOn} />
              </Field>
              <Field id={`ends-${p}`} label="Ends (inclusive)" error={e.endsOn}>
                <Input id={`ends-${p}`} name="endsOn" type="date" defaultValue={d?.endsOn} error={e.endsOn} />
              </Field>
              <Field id={`max-${p}`} label="Total uses" hint="Blank = unlimited">
                <Input id={`max-${p}`} name="maxRedemptions" inputMode="numeric" defaultValue={d?.maxRedemptions} hasHint />
              </Field>
              <Field id={`per-${p}`} label="Uses per customer" hint="By email">
                <Input id={`per-${p}`} name="maxPerCustomer" inputMode="numeric" defaultValue={d?.maxPerCustomer} hasHint />
              </Field>
              <Field id={`desc-${p}`} label="Internal description" className="md:col-span-3">
                <Input id={`desc-${p}`} name="description" maxLength={200} defaultValue={d?.description} />
              </Field>
              <label className="flex items-center gap-2 pt-7 text-sm">
                <input type="checkbox" name="active" defaultChecked={d?.active ?? true} className="size-4" /> Active
              </label>
            </div>
          </>
        );
      }}
    </AdminForm>
  );
}
