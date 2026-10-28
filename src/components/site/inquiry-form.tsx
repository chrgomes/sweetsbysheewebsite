"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
  askBudget: boolean;
  maxFiles: number;
  maxMb: number;
  notice: string | null;
  formToken: string;
  preselect?: string;
};

const EVENT_TYPES = ["Birthday", "Wedding", "Baby shower", "Bridal shower", "Anniversary", "Graduation", "Holiday", "Corporate event", "Other"];
const CONTACT_LABELS = { email: "Email", phone: "Phone call", text: "Text message" } as const;

const STEPS = [
  { title: "About you", fields: ["customerName", "customerEmail", "customerPhone", "preferredContact"] },
  { title: "Your event", fields: ["eventDate", "eventType", "productType", "servings", "tiers", "message"] },
  { title: "The design", fields: ["design", "flavours", "size", "theme", "colours", "inspiration"] },
  { title: "Pickup or delivery", fields: ["fulfillmentMethod", "line1", "line2", "city", "region", "postalCode", "allergies", "budget", "details"] },
  { title: "Review and send", fields: ["acknowledge"] },
] as const;

/** Progress is kept in this tab only (sessionStorage) and never includes photos. */
export const INQUIRY_DRAFT_KEY = "sbs:custom-order-draft";
const SAVED_FIELDS = STEPS.flatMap((s) => s.fields).filter((f) => f !== "inspiration" && f !== "acknowledge");

function stepOf(field: string) {
  const i = STEPS.findIndex((s) => (s.fields as readonly string[]).includes(field));
  return i === -1 ? 0 : i;
}

type Summary = { label: string; value: string }[];

export function InquiryForm({ config }: { config: InquiryFormConfig }) {
  const [state, action, pending] = useActionState<InquiryState, FormData>(submitInquiry, {});
  const v = state.values ?? {};
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [seenState, setSeenState] = useState(state);
  const initialType = v.productType ?? config.productTypes.find((t) => t.value === config.preselect)?.value ?? "";
  const [productType, setProductType] = useState(initialType);
  const [method, setMethod] = useState(v.fulfillmentMethod ?? "pickup");
  const [contact, setContact] = useState(v.preferredContact ?? "email");
  // Selects are controlled: React's post-action form reset ignores updated defaultValues on <select>.
  const [eventType, setEventType] = useState(v.eventType ?? "");
  const [files, setFiles] = useState<{ name: string; tooBig: boolean }[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [restored, setRestored] = useState(false);
  const chosen = config.productTypes.find((t) => t.value === productType);
  const isCake = /cake/i.test(productType) && !/cupcake|cake ?pop/i.test(productType);

  // A server response: show its errors and jump to the first step that has one.
  if (state !== seenState) {
    setSeenState(state);
    const fe = state.fieldErrors ?? {};
    setErrors(fe);
    const keys = Object.keys(fe);
    if (keys.length) setStep(Math.min(...keys.map(stepOf)));
  }

  // Restore saved progress once, unless the server just echoed values back.
  useEffect(() => {
    const form = formRef.current;
    if (!form || state.values) return;
    let saved: Record<string, string> | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(INQUIRY_DRAFT_KEY) ?? "null");
    } catch {
      saved = null;
    }
    if (!saved || typeof saved !== "object") return;
    for (const [k, val] of Object.entries(saved)) {
      if (typeof val !== "string" || !SAVED_FIELDS.includes(k as never)) continue;
      const el = form.elements.namedItem(k);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.value = val;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- syncing from browser storage after hydration */
    if (saved.productType) setProductType(saved.productType);
    if (saved.eventType) setEventType(saved.eventType);
    if (saved.fulfillmentMethod === "pickup" || saved.fulfillmentMethod === "delivery") setMethod(saved.fulfillmentMethod);
    if (saved.preferredContact && saved.preferredContact in CONTACT_LABELS) setContact(saved.preferredContact);
    setRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function save() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const out: Record<string, string> = {};
    for (const k of SAVED_FIELDS) {
      const val = data.get(k);
      if (typeof val === "string" && val) out[k] = val;
    }
    try {
      sessionStorage.setItem(INQUIRY_DRAFT_KEY, JSON.stringify(out));
    } catch {
      // Storage may be unavailable (private mode); progress just isn't kept.
    }
  }

  function clearError(name: string) {
    if (!errors[name]) return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  /** Validate the visible step with the browser's constraint API. */
  function validateStep(i: number): boolean {
    const form = formRef.current;
    if (!form) return true;
    const found: Record<string, string> = {};
    let first: HTMLElement | null = null;
    const fieldset = form.querySelector<HTMLFieldSetElement>(`[data-step="${i}"]`);
    fieldset?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea").forEach((el) => {
      if (!el.name || el.type === "hidden" || el.checkValidity()) return;
      found[el.name] = el.validity.valueMissing ? "This field is required." : el.validationMessage;
      first ??= el;
    });
    if (i === 0 && (contact === "phone" || contact === "text") && !(form.elements.namedItem("customerPhone") as HTMLInputElement).value.trim()) {
      found.customerPhone = "Add a phone number so we can reach you that way.";
      first ??= form.elements.namedItem("customerPhone") as HTMLInputElement;
    }
    if (i === 2 && files.length > config.maxFiles) found.inspiration = `Please choose no more than ${config.maxFiles} images.`;
    if (i === 2 && files.some((f) => f.tooBig)) found.inspiration = `Each photo must be ${config.maxMb} MB or smaller.`;
    setErrors((prev) => ({ ...prev, ...found }));
    (first as HTMLElement | null)?.focus();
    return Object.keys(found).length === 0;
  }

  function buildSummary(): Summary[] {
    const data = new FormData(formRef.current!);
    const get = (k: string) => (typeof data.get(k) === "string" ? (data.get(k) as string).trim() : "");
    const rows = (pairs: [string, string][]) => pairs.filter(([, val]) => val).map(([label, value]) => ({ label, value }));
    const address = [get("line1"), get("line2"), get("city"), get("region"), get("postalCode")].filter(Boolean).join(", ");
    return [
      rows([["Name", get("customerName")], ["Email", get("customerEmail")], ["Phone", get("customerPhone")], ["Contact me by", CONTACT_LABELS[contact as keyof typeof CONTACT_LABELS] ?? "Email"]]),
      rows([["Event date", get("eventDate")], ["Occasion", get("eventType")], ["Item", get("productType")], ["Servings", get("servings")], ["Tiers", get("tiers")], ["Inscription", get("message")]]),
      rows([["Design", get("design")], ["Flavours", get("flavours")], ["Size", get("size")], ["Theme", get("theme")], ["Colours", get("colours")], ["Photos", files.length ? files.map((f) => f.name).join(", ") : ""]]),
      rows([["Fulfilment", method === "delivery" ? `Delivery to ${address || "—"}` : "Pickup"], ["Allergies", get("allergies")], ["Budget", get("budget")], ["Other details", get("details")]]),
    ];
  }

  function go(next: number) {
    if (next > step) {
      for (let i = step; i < next; i++) {
        if (!validateStep(i)) {
          setStep(i);
          return;
        }
      }
    }
    save();
    if (next === STEPS.length - 1) setSummary(buildSummary());
    setStep(next);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  const e = errors;
  const last = STEPS.length - 1;

  return (
    <form
      ref={formRef}
      action={action}
      onInput={(ev) => {
        clearError((ev.target as HTMLInputElement).name);
        save();
      }}
      onSubmit={(ev) => {
        if (step !== last) {
          // Enter in a field advances rather than submitting early.
          ev.preventDefault();
          go(step + 1);
          return;
        }
        if (!validateStep(last)) ev.preventDefault();
      }}
      className="space-y-8"
      noValidate
    >
      <input type="hidden" name="formToken" value={config.formToken} />
      <input type="hidden" name="productId" value={chosen?.productId ?? ""} />
      {/* Honeypot: hidden from people and assistive tech, attractive to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="rounded-2xl border border-honey/30 bg-honey-tint px-5 py-4 text-sm text-ink">
        <p className="font-medium">This is a request, not a confirmed order.</p>
        <p className="mt-1">We review every request personally and will reply about availability and pricing. Your date is only booked once we confirm it with you.{config.notice ? ` ${config.notice}` : ""}</p>
      </div>

      <nav aria-label="Request progress">
        <ol className="grid grid-cols-5 gap-1.5">
          {STEPS.map((s, i) => (
            <li key={s.title} aria-current={i === step ? "step" : undefined}>
              <span className={cn("block h-1.5 rounded-full", i <= step ? "bg-berry" : "bg-line")} />
              <span className={cn("mt-2 hidden text-xs sm:block", i === step ? "font-medium text-ink" : "text-ink-muted")}>{s.title}</span>
            </li>
          ))}
        </ol>
      </nav>

      <div aria-live="polite" className="space-y-3">
        <h2 ref={headingRef} tabIndex={-1} className="font-display text-2xl text-ink outline-none">
          <span className="block text-sm font-sans font-medium tracking-wide text-ink-muted uppercase">Step {step + 1} of {STEPS.length}</span>
          {STEPS[step].title}
        </h2>
        {state.message && <FormAlert>{state.message}</FormAlert>}
        {restored && step === 0 && <p className="text-sm text-ink-muted">We&apos;ve restored what you entered earlier in this tab. Photos need to be added again.</p>}
      </div>

      <fieldset data-step={0} hidden={step !== 0} className="space-y-5">
        <legend className="sr-only">About you</legend>
        <Field id="customerName" label="Full name" required error={e.customerName}>
          <Input id="customerName" autoComplete="name" defaultValue={v.customerName} required maxLength={120} error={e.customerName} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="customerEmail" label="Email" required error={e.customerEmail}>
            <Input id="customerEmail" type="email" autoComplete="email" defaultValue={v.customerEmail} required error={e.customerEmail} />
          </Field>
          <Field id="customerPhone" label="Phone" required={contact !== "email"} error={e.customerPhone}>
            <Input id="customerPhone" type="tel" autoComplete="tel" defaultValue={v.customerPhone} error={e.customerPhone} />
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-ink">How should we contact you?</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(CONTACT_LABELS) as (keyof typeof CONTACT_LABELS)[]).map((c) => (
              <label key={c} className={cn("flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]", contact === c ? "border-ink bg-paper text-ink" : "border-line-strong text-ink-soft")}>
                <input type="radio" name="preferredContact" value={c} checked={contact === c} onChange={() => setContact(c)} className="sr-only" />
                {CONTACT_LABELS[c]}
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>

      <fieldset data-step={1} hidden={step !== 1} className="space-y-5">
        <legend className="sr-only">Your event</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="eventDate" label="Event date" required error={e.eventDate} hint={config.minNoticeDays ? `Please allow at least ${config.minNoticeDays} days' notice.` : undefined}>
            <Input id="eventDate" type="date" min={config.minDate} max={config.maxDate} defaultValue={v.eventDate} required error={e.eventDate} hasHint={!!config.minNoticeDays} />
          </Field>
          <Field id="eventType" label="Occasion" required error={e.eventType}>
            <Select id="eventType" value={eventType} onChange={(ev) => setEventType(ev.target.value)} required error={e.eventType}>
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
      </fieldset>

      <fieldset data-step={2} hidden={step !== 2} className="space-y-5">
        <legend className="sr-only">The design</legend>
        <Field id="design" label="Describe your design" required error={e.design} hint="Style, decorations, anything you've seen and loved.">
          <Textarea id="design" rows={5} defaultValue={v.design} required maxLength={4000} error={e.design} hasHint />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="flavours" label="Flavour preferences" error={e.flavours}><Input id="flavours" maxLength={500} defaultValue={v.flavours} error={e.flavours} /></Field>
          <Field id="size" label="Size preference" error={e.size}><Input id="size" maxLength={120} defaultValue={v.size} error={e.size} /></Field>
          <Field id="theme" label="Theme" error={e.theme}><Input id="theme" maxLength={200} defaultValue={v.theme} error={e.theme} /></Field>
          <Field id="colours" label="Colours" error={e.colours}><Input id="colours" maxLength={200} defaultValue={v.colours} error={e.colours} /></Field>
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

      <fieldset data-step={3} hidden={step !== 3} className="space-y-5">
        <legend className="sr-only">Pickup or delivery</legend>
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
        <Field id="allergies" label="Allergies or dietary needs" error={e.allergies}>
          <Textarea id="allergies" rows={2} maxLength={1000} defaultValue={v.allergies} error={e.allergies} />
        </Field>
        {config.askBudget && (
          <Field id="budget" label="Budget (optional)" error={e.budget} hint="Helps us suggest the right options.">
            <Input id="budget" maxLength={120} defaultValue={v.budget} error={e.budget} hasHint className="sm:max-w-xs" />
          </Field>
        )}
        <Field id="details" label="Other details" error={e.details}>
          <Textarea id="details" rows={3} maxLength={4000} defaultValue={v.details} error={e.details} />
        </Field>
      </fieldset>

      <fieldset data-step={4} hidden={step !== last} className="space-y-6">
        <legend className="sr-only">Review and send</legend>
        {summary.map((rows, i) => (
          <section key={STEPS[i].title} className="rounded-2xl border border-line bg-paper p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium text-ink">{STEPS[i].title}</h3>
              <button type="button" onClick={() => go(i)} className="min-h-11 rounded-full px-3 text-sm font-medium text-berry underline-offset-4 hover:underline">
                Edit<span className="sr-only"> {STEPS[i].title.toLowerCase()}</span>
              </button>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
              {rows.map((r) => (
                <div key={r.label} className="contents">
                  <dt className="text-ink-muted">{r.label}</dt>
                  <dd className="break-words whitespace-pre-line text-ink">{r.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <label className="flex items-start gap-3 text-sm text-ink">
          <input type="checkbox" name="acknowledge" required className="mt-0.5 size-5 shrink-0 accent-[var(--berry)]" aria-invalid={e.acknowledge ? true : undefined} aria-describedby={e.acknowledge ? "acknowledge-error" : undefined} onChange={() => clearError("acknowledge")} />
          <span>I understand this is a request and not a confirmed order. My order is confirmed only when the bakery confirms it with me.</span>
        </label>
        {e.acknowledge && <p id="acknowledge-error" className="text-sm font-medium text-danger">{e.acknowledge === "This field is required." ? "Please confirm you understand this is a request." : e.acknowledge}</p>}
      </fieldset>

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-between">
        {step > 0 ? (
          <Button type="button" variant="secondary" onClick={() => go(step - 1)}>Back</Button>
        ) : (
          <span />
        )}
        {step < last ? (
          <Button key="next" type="button" onClick={() => go(step + 1)}>{step === last - 1 ? "Review request" : "Continue"}</Button>
        ) : (
          <Button key="submit" type="submit" size="lg" disabled={pending}>{pending ? "Sending your request…" : "Send request"}</Button>
        )}
      </div>
      <p className="text-xs text-ink-muted">Your answers are kept in this browser tab until you send them or close the tab.</p>
    </form>
  );
}

/** Forget saved progress once a request has been sent. */
export function ClearInquiryDraft() {
  useEffect(() => {
    try {
      sessionStorage.removeItem(INQUIRY_DRAFT_KEY);
    } catch {
      // Nothing to clear.
    }
  }, []);
  return null;
}
