"use client";

import { useActionState, useState } from "react";
import { submitInquiry, type InquiryState } from "@/app/actions/inquiry";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, FormAlert, Input, Select, Textarea } from "@/components/ui/field";

export type InquiryFormConfig = {
  productTypes: { value: string; label: string; productId?: string }[];
  minDate: string;
  maxDate: string;
  minNoticeDays: number;
  deliveryEnabled: boolean;
  deliveryArea: string | null;
  maxFiles: number;
  maxMb: number;
  notice: string | null;
  formToken: string;
  preselect?: string;
};

const EVENT_TYPES = ["Birthday", "Wedding", "Baby shower", "Bridal shower", "Anniversary", "Graduation", "Holiday", "Corporate event", "Other"];

export function InquiryForm({ config }: { config: InquiryFormConfig }) {
  const [state, action, pending] = useActionState<InquiryState, FormData>(submitInquiry, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const initialType = v.productType ?? config.productTypes.find((t) => t.value === config.preselect)?.value ?? "";
  const [productType, setProductType] = useState(initialType);
  const [method, setMethod] = useState(v.fulfillmentMethod ?? "pickup");
  const [files, setFiles] = useState<{ name: string; tooBig: boolean }[]>([]);
  const chosen = config.productTypes.find((t) => t.value === productType);
  const isCake = /cake/i.test(productType) && !/cupcake|cake ?pop/i.test(productType);

  return (
    <form action={action} className="space-y-12" noValidate encType="multipart/form-data">
      <input type="hidden" name="formToken" value={config.formToken} />
      <input type="hidden" name="productId" value={chosen?.productId ?? ""} />
      {/* Honeypot: hidden from people and assistive tech, attractive to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="rounded-2xl border border-honey/30 bg-honey-tint px-5 py-4 text-sm text-[#5c4322]">
        <p className="font-medium">This is a request, not a confirmed order.</p>
        <p className="mt-1">We review every request personally and will reply about availability and pricing. Your date is only booked once we confirm it with you.{config.notice ? ` ${config.notice}` : ""}</p>
      </div>

      {state.message && <FormAlert>{state.message}</FormAlert>}

      <fieldset className="space-y-5">
        <legend className="font-display text-2xl text-ink">About you</legend>
        <Field id="customerName" label="Full name" required error={e.customerName}>
          <Input id="customerName" autoComplete="name" defaultValue={v.customerName} required error={e.customerName} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="customerEmail" label="Email" required error={e.customerEmail}>
            <Input id="customerEmail" type="email" autoComplete="email" defaultValue={v.customerEmail} required error={e.customerEmail} />
          </Field>
          <Field id="customerPhone" label="Phone" error={e.customerPhone}>
            <Input id="customerPhone" type="tel" autoComplete="tel" defaultValue={v.customerPhone} error={e.customerPhone} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-display text-2xl text-ink">Your event</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="eventDate" label="Event date" required error={e.eventDate} hint={config.minNoticeDays ? `Please allow at least ${config.minNoticeDays} days' notice.` : undefined}>
            <Input id="eventDate" type="date" min={config.minDate} max={config.maxDate} defaultValue={v.eventDate} required error={e.eventDate} hasHint={!!config.minNoticeDays} />
          </Field>
          <Field id="eventType" label="Occasion" required error={e.eventType}>
            <Select id="eventType" defaultValue={v.eventType ?? ""} required error={e.eventType}>
              <option value="" disabled>Choose an occasion</option>
              {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="productType" label="What would you like?" required error={e.productType}>
            <Select id="productType" value={productType} onChange={(ev) => setProductType(ev.target.value)} required error={e.productType}>
              <option value="" disabled>Choose one</option>
              {config.productTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field id="servings" label="Servings or quantity" error={e.servings} hint="Roughly how many guests or pieces?">
            <Input id="servings" type="number" inputMode="numeric" min={1} max={2000} defaultValue={v.servings} error={e.servings} hasHint />
          </Field>
        </div>
        {isCake && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="tiers" label="Number of tiers" error={e.tiers}>
              <Input id="tiers" type="number" inputMode="numeric" min={1} max={10} defaultValue={v.tiers} error={e.tiers} />
            </Field>
            <Field id="message" label="Message or inscription" error={e.message}>
              <Input id="message" maxLength={200} defaultValue={v.message} error={e.message} />
            </Field>
          </div>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="flavours" label="Flavour preferences" error={e.flavours}>
            <Input id="flavours" defaultValue={v.flavours} error={e.flavours} />
          </Field>
          <Field id="size" label="Size preference" error={e.size}>
            <Input id="size" defaultValue={v.size} error={e.size} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-display text-2xl text-ink">The design</legend>
        <Field id="design" label="Describe your design" required error={e.design} hint="Style, decorations, anything you've seen and loved.">
          <Textarea id="design" rows={5} defaultValue={v.design} required error={e.design} hasHint />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="theme" label="Theme" error={e.theme}><Input id="theme" defaultValue={v.theme} error={e.theme} /></Field>
          <Field id="colours" label="Colours" error={e.colours}><Input id="colours" defaultValue={v.colours} error={e.colours} /></Field>
        </div>
        <Field id="inspiration" label="Inspiration photos" error={e.inspiration} hint={`Up to ${config.maxFiles} images (JPEG, PNG, WebP, GIF or HEIC), ${config.maxMb} MB each. Only our team can see them.`}>
          <input
            id="inspiration"
            name="inspiration"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
            multiple
            aria-describedby={["inspiration-hint", e.inspiration && "inspiration-error"].filter(Boolean).join(" ")}
            aria-invalid={e.inspiration ? true : undefined}
            onChange={(ev) => setFiles([...(ev.target.files ?? [])].map((f) => ({ name: f.name, tooBig: f.size > config.maxMb * 1024 * 1024 })))}
            className="block w-full rounded-xl border border-dashed border-line-strong bg-white px-4 py-5 text-sm text-ink-soft file:mr-4 file:rounded-full file:border-0 file:bg-blush file:px-4 file:py-2 file:text-sm file:font-medium file:text-berry-deep hover:border-ink-muted"
          />
          {files.length > 0 && (
            <ul className="mt-2 text-sm text-ink-soft" aria-live="polite">
              {files.length > config.maxFiles && <li className="text-danger">Please choose no more than {config.maxFiles} images.</li>}
              {files.map((f) => (
                <li key={f.name} className={f.tooBig ? "text-danger" : undefined}>
                  • {f.name}
                  {f.tooBig && ` — larger than ${config.maxMb} MB, please choose a smaller photo`}
                </li>
              ))}
            </ul>
          )}
        </Field>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-display text-2xl text-ink">Pickup or delivery</legend>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Pickup or delivery preference">
          {(["pickup", "delivery"] as const).map((m) => (
            <label key={m} className={cn("flex cursor-pointer flex-col rounded-2xl border p-5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]", method === m ? "border-ink bg-paper" : "border-line-strong hover:border-ink-muted")}>
              <input type="radio" name="fulfillmentMethod" value={m} checked={method === m} onChange={() => setMethod(m)} className="sr-only" />
              <span className="font-medium text-ink">{m === "pickup" ? "I'll pick it up" : "I'd like delivery"}</span>
              <span className="mt-1 text-sm text-ink-soft">
                {m === "pickup" ? "We'll share pickup details when we confirm." : config.deliveryArea ? `Delivery area: ${config.deliveryArea}` : config.deliveryEnabled ? "Subject to availability." : "Ask us — delivery isn't always available."}
              </span>
            </label>
          ))}
        </div>
        {e.fulfillmentMethod && <p className="text-sm font-medium text-danger">{e.fulfillmentMethod}</p>}
        {method === "delivery" && (
          <div className="space-y-5 rounded-2xl border border-line bg-paper p-5">
            <Field id="line1" label="Street address" required error={e.line1}><Input id="line1" autoComplete="address-line1" defaultValue={v.line1} required error={e.line1} /></Field>
            <Field id="line2" label="Apartment, suite, venue name" error={e.line2}><Input id="line2" autoComplete="address-line2" defaultValue={v.line2} error={e.line2} /></Field>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field id="city" label="City" required error={e.city}><Input id="city" autoComplete="address-level2" defaultValue={v.city} required error={e.city} /></Field>
              <Field id="region" label="State" required error={e.region}><Input id="region" autoComplete="address-level1" defaultValue={v.region} required error={e.region} /></Field>
              <Field id="postalCode" label="ZIP code" required error={e.postalCode}><Input id="postalCode" autoComplete="postal-code" inputMode="numeric" defaultValue={v.postalCode} required error={e.postalCode} /></Field>
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-display text-2xl text-ink">Anything else</legend>
        <Field id="allergies" label="Allergies or dietary needs" error={e.allergies}>
          <Textarea id="allergies" rows={2} defaultValue={v.allergies} error={e.allergies} />
        </Field>
        <Field id="budget" label="Budget" error={e.budget} hint="Helps us suggest the right options.">
          <Input id="budget" defaultValue={v.budget} error={e.budget} hasHint className="sm:max-w-xs" />
        </Field>
        <Field id="details" label="Other details" error={e.details}>
          <Textarea id="details" rows={3} defaultValue={v.details} error={e.details} />
        </Field>
      </fieldset>

      <div className="space-y-5 border-t border-line pt-8">
        <label className="flex items-start gap-3 text-sm text-ink">
          <input type="checkbox" name="acknowledge" required className="mt-0.5 size-5 shrink-0 accent-[var(--berry)]" aria-invalid={e.acknowledge ? true : undefined} aria-describedby={e.acknowledge ? "acknowledge-error" : undefined} />
          <span>I understand this is a request and not a confirmed order. My order is confirmed only when the bakery confirms it with me.</span>
        </label>
        {e.acknowledge && <p id="acknowledge-error" className="text-sm font-medium text-danger">{e.acknowledge}</p>}
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Sending your request…" : "Send request"}
        </Button>
      </div>
    </form>
  );
}
