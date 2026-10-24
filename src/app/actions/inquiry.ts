"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { createInquiry, inquirySchema } from "@/lib/inquiries";
import { log } from "@/lib/log";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { checkSpam, FORM_TOKEN_FIELD, HONEYPOT_FIELD } from "@/lib/spam";
import { validateImageUploads } from "@/lib/uploads";
import { fieldErrors } from "@/lib/validation";

export type InquiryState = { message?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

const TEXT_FIELDS = [
  "customerName", "customerEmail", "customerPhone", "eventDate", "eventType", "productType", "productId", "servings", "tiers",
  "size", "flavours", "design", "theme", "colours", "message", "fulfillmentMethod", "allergies", "budget", "details",
  "line1", "line2", "city", "region", "postalCode",
] as const;

export async function submitInquiry(_prev: InquiryState, form: FormData): Promise<InquiryState> {
  const values: Record<string, string> = {};
  for (const k of TEXT_FIELDS) {
    const v = form.get(k);
    if (typeof v === "string") values[k] = v;
  }

  const spam = checkSpam({ honeypot: form.get(HONEYPOT_FIELD) as string | null, token: form.get(FORM_TOKEN_FIELD) as string | null });
  if (spam) {
    log.warn("inquiry.spam_rejected", { reason: spam });
    // Deliberately vague; an expired token is the only case a real person hits.
    return { message: spam === "expired" ? "This form has expired. Please reload the page and try again." : "Sorry, we couldn't accept that submission. Please try again.", values };
  }

  const limit = await rateLimit("inquiry", await clientIp(), 5, 3600);
  if (!limit.allowed) return { message: "You've sent several requests recently. Please wait a while or contact us directly.", values };

  const delivery = values.fulfillmentMethod === "delivery";
  const parsed = inquirySchema.safeParse({
    ...values,
    deliveryAddress: delivery ? { line1: values.line1, line2: values.line2, city: values.city, region: values.region, postalCode: values.postalCode } : undefined,
    acknowledge: form.get("acknowledge") === "on",
  });
  if (!parsed.success) {
    const errs = Object.fromEntries(Object.entries(fieldErrors(parsed.error)).map(([k, v]) => [k.replace(/^deliveryAddress\./, ""), v]));
    return { message: "Please check the highlighted fields.", fieldErrors: errs, values };
  }

  const files = form.getAll("inspiration").filter((f): f is File => f instanceof File);
  const uploads = await validateImageUploads(files, { maxFiles: env().MAX_UPLOAD_FILES, maxBytes: env().MAX_UPLOAD_MB * 1024 * 1024, allowHeic: true });
  if (!uploads.ok) return { message: uploads.errors.map((e) => e.message).join(" "), fieldErrors: { inspiration: uploads.errors[0].message }, values };

  const result = await createInquiry(parsed.data, uploads.files);
  if (!result.ok) return { message: result.message, fieldErrors: result.fieldErrors, values };
  redirect(`/custom-orders/thanks?ref=${encodeURIComponent(result.reference)}`);
}
