import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit, type Actor } from "@/lib/audit";
import { addDays, dateInZone, isIsoDate } from "@/lib/dates";
import { env, siteUrl } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { inquiryAcknowledgementEmail, inquiryNotificationEmail, quoteEmail } from "@/lib/email/templates";
import { log } from "@/lib/log";
import { taxFor } from "@/lib/money";
import { paymentProvider } from "@/lib/payments";
import { getSettings, type SiteSettings } from "@/lib/settings";
import { deleteFile, putFile } from "@/lib/storage";
import { makeReference, randomToken, sha256 } from "@/lib/tokens";
import type { ValidatedUpload } from "@/lib/uploads";
import { addressSchema, emailSchema, nameSchema, optionalPhoneSchema, optionalText, requiredText } from "@/lib/validation";

export const INQUIRY_STATUSES = schema.inquiryStatus.enumValues;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  quoted: "Quoted",
  accepted: "Accepted",
  declined: "Declined",
  completed: "Completed",
};

const optionalInt = (min: number, max: number, label: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : Number(v)))
    .refine((v) => v === undefined || (Number.isInteger(v) && v >= min && v <= max), `${label} must be a whole number between ${min} and ${max}.`);

export const inquirySchema = z
  .object({
    customerName: nameSchema,
    customerEmail: emailSchema,
    customerPhone: optionalPhoneSchema,
    eventDate: z.string().refine(isIsoDate, "Please choose your event date."),
    eventType: requiredText(80, "Please tell us the occasion."),
    productType: requiredText(80, "Please choose what you'd like."),
    productId: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.uuid().optional()),
    servings: optionalInt(1, 2000, "Servings"),
    tiers: optionalInt(1, 10, "Tiers"),
    size: optionalText(120),
    flavours: optionalText(500),
    design: requiredText(4000, "Please describe the design you have in mind."),
    theme: optionalText(200),
    colours: optionalText(200),
    message: optionalText(200),
    fulfillmentMethod: z.enum(["pickup", "delivery"], { error: "Please choose pickup or delivery." }),
    deliveryAddress: addressSchema.optional(),
    allergies: optionalText(1000),
    budget: optionalText(120),
    details: optionalText(4000),
    acknowledge: z.literal(true, { error: "Please confirm you understand this is a request, not a confirmed order." }),
  })
  .superRefine((v, ctx) => {
    if (v.fulfillmentMethod === "delivery" && !v.deliveryAddress) {
      ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Please enter the delivery address." });
    }
  });

export type InquiryInput = z.infer<typeof inquirySchema>;

export function checkEventDate(isoDate: string, s: SiteSettings, now = new Date()): string | null {
  const today = dateInZone(now, s.timezone);
  const earliest = addDays(today, s.customOrderMinNoticeDays);
  if (isoDate < earliest) {
    return s.customOrderMinNoticeDays > 0
      ? `Custom orders need at least ${s.customOrderMinNoticeDays} days' notice. The earliest date we can consider is ${earliest}.`
      : "Please choose a date in the future.";
  }
  if (isoDate > addDays(today, 730)) return "Please choose a date within the next two years.";
  if (s.blackoutDates.includes(isoDate)) return "We're unavailable on that date. Please choose another.";
  return null;
}

export type CreateInquiryResult = { ok: true; reference: string; id: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

export async function createInquiry(input: InquiryInput, uploads: ValidatedUpload[]): Promise<CreateInquiryResult> {
  const s = await getSettings();
  if (!s.customOrdersEnabled) return { ok: false, message: "We aren't taking custom order requests right now." };
  const dateProblem = checkEventDate(input.eventDate, s);
  if (dateProblem) return { ok: false, message: dateProblem, fieldErrors: { eventDate: dateProblem } };

  let productId: string | null = null;
  if (input.productId) {
    const p = await db().query.products.findFirst({ where: eq(schema.products.id, input.productId), columns: { id: true, customOrder: true } });
    productId = p?.customOrder ? p.id : null;
  }

  // Store files first; if the database insert fails, remove them again.
  const stored: { key: string; upload: ValidatedUpload }[] = [];
  try {
    for (const u of uploads) stored.push({ key: await putFile("private", u.kind.ext, u.bytes), upload: u });

    const inquiry = await db().transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.inquiries)
        .values({
          reference: makeReference("REQ"),
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone ?? null,
          eventDate: input.eventDate,
          eventType: input.eventType,
          productType: input.productType,
          productId,
          servings: input.servings ?? null,
          tiers: input.tiers ?? null,
          size: input.size ?? null,
          flavours: input.flavours ?? null,
          design: input.design,
          theme: input.theme ?? null,
          colours: input.colours ?? null,
          message: input.message ?? null,
          fulfillmentMethod: input.fulfillmentMethod,
          deliveryAddress: input.fulfillmentMethod === "delivery" ? input.deliveryAddress : null,
          allergies: input.allergies ?? null,
          budget: input.budget ?? null,
          details: input.details ?? null,
        })
        .returning();
      if (stored.length) {
        await tx.insert(schema.inquiryAttachments).values(
          stored.map((f) => ({
            inquiryId: row.id,
            storageKey: f.key,
            originalName: f.upload.name,
            mimeType: f.upload.kind.mime,
            sizeBytes: f.upload.bytes.byteLength,
          })),
        );
      }
      return row;
    });

    log.info("inquiry.created", { inquiryId: inquiry.id, reference: inquiry.reference, attachments: stored.length });
    await notifyInquiry(inquiry, s, stored.length);
    return { ok: true, reference: inquiry.reference, id: inquiry.id };
  } catch (err) {
    log.error("inquiry.create_failed", { error: String(err) });
    await Promise.all(stored.map((f) => deleteFile("private", f.key).catch(() => undefined)));
    return { ok: false, message: "Sorry, we couldn't save your request. Please try again." };
  }
}

/** Email the business and the customer. Failures are recorded on the inquiry, never lost silently. */
async function notifyInquiry(inquiry: typeof schema.inquiries.$inferSelect, s: SiteSettings, attachmentCount: number) {
  const businessTo = env().BUSINESS_NOTIFICATION_EMAIL ?? s.contactEmail;
  const business = businessTo ? await sendEmail(inquiryNotificationEmail(inquiry, businessTo, attachmentCount)) : { ok: false as const, error: "no business email configured" };
  const customer = await sendEmail(inquiryAcknowledgementEmail(inquiry, s));
  await db()
    .update(schema.inquiries)
    .set({
      businessEmailStatus: business.ok ? "sent" : `failed: ${business.error}`.slice(0, 200),
      customerEmailStatus: customer.ok ? "sent" : `failed: ${customer.error}`.slice(0, 200),
    })
    .where(eq(schema.inquiries.id, inquiry.id));
}

export async function updateInquiry(
  actor: Actor,
  id: string,
  patch: { status?: InquiryStatus; quotedPriceCents?: number | null; quoteNotes?: string | null; internalNotes?: string | null },
) {
  const before = await db().query.inquiries.findFirst({ where: eq(schema.inquiries.id, id) });
  if (!before) return { ok: false as const, message: "Request not found." };
  await db().update(schema.inquiries).set(patch).where(eq(schema.inquiries.id, id));
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const prev = before[k as keyof typeof before];
    if (prev !== v) changes[k] = { from: prev, to: v };
  }
  if (Object.keys(changes).length) await audit(actor, "inquiry.updated", "inquiry", id, changes);
  return { ok: true as const };
}

/**
 * Turn an agreed quote into a payable order: one line at the agreed price,
 * with tax and delivery per the current settings. The customer pays through
 * the normal hosted checkout; the order is paid only via webhook.
 */
export async function convertInquiryToOrder(actor: Actor, id: string, opts: { sendEmail: boolean }) {
  const inquiry = await db().query.inquiries.findFirst({ where: eq(schema.inquiries.id, id) });
  if (!inquiry) return { ok: false as const, message: "Request not found." };
  if (inquiry.convertedOrderId) return { ok: false as const, message: "This request has already been converted to an order." };
  if (inquiry.quotedPriceCents === null || inquiry.quotedPriceCents <= 0) return { ok: false as const, message: "Set the agreed price first." };
  const s = await getSettings();
  const provider = paymentProvider();
  if (s.taxRateBps === null) return { ok: false as const, message: "Configure sales tax in settings before creating payable orders." };
  if (inquiry.fulfillmentMethod === "delivery" && s.deliveryFeeCents === null) {
    return { ok: false as const, message: "Set a delivery fee in settings, or change the request to pickup." };
  }

  const deliveryFeeCents = inquiry.fulfillmentMethod === "delivery" ? s.deliveryFeeCents! : 0;
  const subtotal = inquiry.quotedPriceCents;
  const taxCents = taxFor(subtotal + deliveryFeeCents, s.taxRateBps);
  const accessToken = randomToken(24);
  const name = `Custom order: ${inquiry.productType} (${inquiry.reference})`;

  const order = await db().transaction(async (tx) => {
    const [o] = await tx
      .insert(schema.orders)
      .values({
        reference: makeReference("SBS"),
        customerName: inquiry.customerName,
        customerEmail: inquiry.customerEmail,
        customerPhone: inquiry.customerPhone,
        fulfillmentMethod: inquiry.fulfillmentMethod,
        fulfillmentDate: inquiry.eventDate,
        deliveryAddress: inquiry.deliveryAddress,
        notes: inquiry.quoteNotes,
        subtotalCents: subtotal,
        taxCents,
        deliveryFeeCents,
        totalCents: subtotal + taxCents + deliveryFeeCents,
        currency: s.currency,
        taxRateBps: s.taxRateBps!,
        paymentProvider: provider?.name ?? null,
        accessTokenHash: sha256(accessToken),
        sourceInquiryId: inquiry.id,
      })
      .returning();
    await tx.insert(schema.orderItems).values({ orderId: o.id, productId: inquiry.productId, productName: name, options: [], unitPriceCents: subtotal, quantity: 1, lineTotalCents: subtotal });
    await tx.update(schema.inquiries).set({ convertedOrderId: o.id, status: "accepted" }).where(eq(schema.inquiries.id, inquiry.id));
    return o;
  });

  let paymentUrl: string | null = null;
  if (provider) {
    try {
      const session = await provider.createCheckout({
        orderId: order.id,
        reference: order.reference,
        currency: order.currency,
        customerEmail: order.customerEmail,
        lines: [{ name, unitAmountCents: subtotal, quantity: 1, description: inquiry.quoteNotes ?? undefined }],
        taxCents,
        taxLabel: s.taxLabel,
        deliveryFeeCents,
        successUrl: siteUrl(`/order/${order.reference}?t=${accessToken}`),
        cancelUrl: siteUrl(`/order/${order.reference}?t=${accessToken}`),
      });
      await db().update(schema.orders).set({ paymentSessionId: session.sessionId }).where(eq(schema.orders.id, order.id));
      paymentUrl = session.url.startsWith("/") ? siteUrl(session.url) : session.url;
    } catch (err) {
      log.error("inquiry.convert_checkout_failed", { inquiryId: id, orderId: order.id, error: String(err) });
    }
  }

  await audit(actor, "inquiry.converted", "inquiry", id, { orderId: order.id, priceCents: subtotal, taxCents, deliveryFeeCents });
  let emailed = false;
  if (opts.sendEmail) {
    emailed = (await sendEmail(quoteEmail(inquiry, s, subtotal + taxCents + deliveryFeeCents, paymentUrl))).ok;
  }
  return { ok: true as const, orderId: order.id, paymentUrl, emailed };
}
