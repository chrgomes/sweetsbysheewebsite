import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit, type Actor } from "@/lib/audit";
import { upsertCustomer } from "@/lib/customers";
import { addDays, dateInZone, isIsoDate } from "@/lib/dates";
import { siteUrl } from "@/lib/env";
import { inquiryLink, linkToken, verifyLinkToken } from "@/lib/links";
import { log } from "@/lib/log";
import { businessRecipient, deliverNow, enqueue } from "@/lib/notifications";
import * as T from "@/lib/notifications/templates";
import { getSettings, type SiteSettings } from "@/lib/settings";
import { deleteFile, putFile } from "@/lib/storage";
import { makeReference } from "@/lib/tokens";
import type { ValidatedUpload } from "@/lib/uploads";
import { addressSchema, emailSchema, nameSchema, optionalPhoneSchema, optionalText, requiredText } from "@/lib/validation";

export const INQUIRY_STATUSES = schema.inquiryStatus.enumValues;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "Inquiry received",
  reviewing: "Under review",
  quote_prepared: "Quote prepared",
  awaiting_customer: "Awaiting customer approval",
  deposit_required: "Deposit required",
  confirmed: "Confirmed",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
  completed: "Completed",
};

/** Customer-facing wording for the request status page. */
export const INQUIRY_STATUS_PUBLIC: Record<InquiryStatus, string> = {
  new: "Received — we'll review it soon",
  reviewing: "We're reviewing your request",
  quote_prepared: "We're preparing your quote",
  awaiting_customer: "Your quote is ready",
  deposit_required: "Awaiting payment to confirm",
  confirmed: "Confirmed",
  declined: "We're unable to take this request",
  expired: "Quote expired",
  cancelled: "Cancelled",
  completed: "Completed",
};

/** Statuses staff may set by hand. Quote-related statuses change through quote actions only. */
export const MANUAL_INQUIRY_STATUSES: InquiryStatus[] = ["new", "reviewing", "declined", "cancelled"];

export const CONTACT_METHODS = ["email", "phone", "text"] as const;

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
    preferredContact: z.enum(CONTACT_METHODS).default("email"),
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
    if ((v.preferredContact === "phone" || v.preferredContact === "text") && !v.customerPhone) {
      ctx.addIssue({ code: "custom", path: ["customerPhone"], message: "Add a phone number so we can reach you that way." });
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

export type CreateInquiryResult = { ok: true; reference: string; id: string; token: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

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

  // Store files first; if the database work fails, remove them again.
  const stored: { key: string; upload: ValidatedUpload }[] = [];
  try {
    for (const u of uploads) stored.push({ key: await putFile("private", u.kind.ext, u.bytes), upload: u });

    let ids: (string | null)[] = [];
    const inquiry = await db().transaction(async (tx) => {
      const customerId = await upsertCustomer(tx, { email: input.customerEmail, name: input.customerName, phone: input.customerPhone });
      const [row] = await tx
        .insert(schema.inquiries)
        .values({
          reference: makeReference("REQ"),
          customerId,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone ?? null,
          preferredContact: input.preferredContact,
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
          budget: s.askBudget ? (input.budget ?? null) : null,
          details: input.details ?? null,
        })
        .returning();
      if (stored.length) {
        await tx.insert(schema.inquiryAttachments).values(
          stored.map((f) => ({ inquiryId: row.id, storageKey: f.key, originalName: f.upload.name, mimeType: f.upload.kind.mime, sizeBytes: f.upload.bytes.byteLength })),
        );
      }
      ids.push(await enqueue(tx, { kind: "inquiry.received", dedupeKey: `inquiry:${row.id}:received`, to: row.customerEmail, email: T.inquiryReceived(row, s, inquiryLink(row)), replyTo: s.contactEmail, related: { type: "inquiry", id: row.id } }));
      const biz = businessRecipient(s);
      if (biz) {
        ids.push(await enqueue(tx, { kind: "inquiry.new_business", dedupeKey: `inquiry:${row.id}:business`, to: biz, email: T.newInquiryForBusiness(row, s, siteUrl(`/admin/inquiries/${row.id}`), stored.length), replyTo: row.customerEmail, related: { type: "inquiry", id: row.id } }));
      } else {
        log.warn("inquiry.no_business_recipient", { inquiryId: row.id });
      }
      return row;
    });
    ids = ids.filter(Boolean);
    await deliverNow(ids);
    log.info("inquiry.created", { inquiryId: inquiry.id, reference: inquiry.reference, attachments: stored.length });
    return { ok: true, reference: inquiry.reference, id: inquiry.id, token: linkToken("inquiry", inquiry.id) };
  } catch (err) {
    log.error("inquiry.create_failed", { error: String(err) });
    await Promise.all(stored.map((f) => deleteFile("private", f.key).catch(() => undefined)));
    return { ok: false, message: "Sorry, we couldn't save your request. Please try again." };
  }
}

/** Staff update of review status and internal notes. */
export async function updateInquiry(actor: Actor, id: string, patch: { status?: InquiryStatus; internalNotes?: string | null }) {
  const before = await db().query.inquiries.findFirst({ where: eq(schema.inquiries.id, id) });
  if (!before) return { ok: false as const, message: "Request not found." };
  if (patch.status && patch.status !== before.status && !MANUAL_INQUIRY_STATUSES.includes(patch.status)) {
    return { ok: false as const, message: "That status is set by the quote workflow." };
  }
  await db().update(schema.inquiries).set(patch).where(eq(schema.inquiries.id, id));
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const prev = before[k as keyof typeof before];
    if (prev !== v) changes[k] = k === "internalNotes" ? "changed" : { from: prev, to: v };
  }
  if (Object.keys(changes).length) await audit(actor, "inquiry.updated", "inquiry", id, changes);
  return { ok: true as const };
}

/** A request, for the customer's status page; requires the token from their link. */
export async function getInquiryForCustomer(reference: string, token: string | undefined) {
  if (!/^REQ-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(reference)) return null;
  const inquiry = await db().query.inquiries.findFirst({
    where: eq(schema.inquiries.reference, reference),
    with: { quotes: { with: { lines: true } }, attachments: { columns: { id: true } } },
  });
  if (!inquiry || !verifyLinkToken("inquiry", inquiry.id, token)) return null;
  return inquiry;
}
