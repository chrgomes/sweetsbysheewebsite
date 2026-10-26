import "server-only";
import { and, desc, eq, inArray, lt, max } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { claimCapacity, dayUsage } from "@/lib/capacity";
import { isIsoDate } from "@/lib/dates";
import { siteUrl } from "@/lib/env";
import { linkToken, orderLink, quoteLink, verifyLinkToken } from "@/lib/links";
import { log } from "@/lib/log";
import { businessRecipient, deliverNow, enqueue } from "@/lib/notifications";
import * as T from "@/lib/notifications/templates";
import { paymentProvider } from "@/lib/payments";
import { depositFor, orderTotals } from "@/lib/pricing";
import { startOrderPayment } from "@/lib/orders";
import { getSettings } from "@/lib/settings";
import { makeReference, sha256 } from "@/lib/tokens";

/**
 * Quotes for custom requests. A request can have several versions; only one
 * is "sent" at a time (sending a new version withdraws the previous). The
 * customer accepts or declines through a signed link. Acceptance creates
 * exactly one order (orders.source_quote_id is unique), holds the date, and
 * asks for the deposit or full payment. Nothing is confirmed until paid.
 */
type QuoteStatus = (typeof schema.quoteStatus.enumValues)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent — awaiting customer",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

export const quoteDraftSchema = z.object({
  fulfillmentMethod: z.enum(["pickup", "delivery"]),
  fulfillmentDate: z.string().refine(isIsoDate, "Choose a valid date."),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1, "Every line needs a description.").max(300),
        quantity: z.number().int().min(1).max(999),
        unitPriceCents: z.number().int().min(0).max(10_000_000),
      }),
    )
    .min(1, "Add at least one line.")
    .max(30),
  deliveryFeeCents: z.number().int().min(0).max(1_000_000),
  /** Null = use the default deposit from settings. */
  depositCents: z.number().int().min(0).nullable(),
  capacityUnits: z.number().int().min(0).max(1000),
  customerMessage: z.string().trim().max(2000).nullable(),
});
export type QuoteDraftInput = z.infer<typeof quoteDraftSchema>;

/** Create or update the request's current draft. Only drafts are editable; sent quotes are revised by a new version. */
export async function saveDraftQuote(actor: Actor, inquiryId: string, input: QuoteDraftInput) {
  const s = await getSettings();
  if (s.taxRateBps === null) return { ok: false as const, message: "Set the sales-tax rate in Settings before preparing quotes." };
  const inquiry = await db().query.inquiries.findFirst({ where: eq(schema.inquiries.id, inquiryId) });
  if (!inquiry) return { ok: false as const, message: "Request not found." };
  if (["confirmed", "completed", "cancelled"].includes(inquiry.status)) return { ok: false as const, message: "This request is closed; quotes can't be changed." };

  const lines = input.lines.map((l, i) => ({ ...l, lineTotalCents: l.quantity * l.unitPriceCents, sortOrder: i }));
  const subtotalCents = lines.reduce((n, l) => n + l.lineTotalCents, 0);
  if (subtotalCents <= 0) return { ok: false as const, message: "The quote total must be more than zero." };
  const totals = orderTotals({ subtotalCents, deliveryFeeCents: input.fulfillmentMethod === "delivery" ? input.deliveryFeeCents : 0, taxRateBps: s.taxRateBps });
  const depositCents = input.depositCents ?? depositFor(totals.totalCents, s.depositPercentBps);
  if (depositCents > totals.totalCents) return { ok: false as const, message: "The deposit can't be more than the total." };

  const values = {
    fulfillmentMethod: input.fulfillmentMethod,
    fulfillmentDate: input.fulfillmentDate,
    subtotalCents,
    deliveryFeeCents: totals.deliveryFeeCents,
    taxRateBps: s.taxRateBps,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    depositCents,
    currency: s.currency,
    capacityUnits: input.capacityUnits,
    customerMessage: input.customerMessage || null,
  };

  const quoteId = await db().transaction(async (tx) => {
    const draft = await tx.query.quotes.findFirst({ where: and(eq(schema.quotes.inquiryId, inquiryId), eq(schema.quotes.status, "draft")) });
    let id: string;
    if (draft) {
      await tx.update(schema.quotes).set(values).where(eq(schema.quotes.id, draft.id));
      await tx.delete(schema.quoteLines).where(eq(schema.quoteLines.quoteId, draft.id));
      id = draft.id;
    } else {
      const [{ v }] = await tx.select({ v: max(schema.quotes.version) }).from(schema.quotes).where(eq(schema.quotes.inquiryId, inquiryId));
      const [row] = await tx
        .insert(schema.quotes)
        .values({ ...values, inquiryId, reference: makeReference("QTE"), version: (v ?? 0) + 1, createdBy: actor.id })
        .returning({ id: schema.quotes.id });
      id = row.id;
    }
    await tx.insert(schema.quoteLines).values(lines.map((l) => ({ quoteId: id, ...l })));
    if (["new", "reviewing"].includes(inquiry.status)) await tx.update(schema.inquiries).set({ status: "quote_prepared" }).where(eq(schema.inquiries.id, inquiryId));
    return id;
  });
  await audit(actor, "quote.saved", "inquiry", inquiryId, { quoteId, totalCents: totals.totalCents, depositCents });
  return { ok: true as const, quoteId };
}

/**
 * Send a draft to the customer. Warns (and requires `force`) when the date is
 * already at capacity, since sending doesn't hold the date.
 */
export async function sendQuote(actor: Actor, quoteId: string, opts: { force?: boolean } = {}) {
  const s = await getSettings();
  const quote = await db().query.quotes.findFirst({ where: eq(schema.quotes.id, quoteId), with: { lines: true, inquiry: true } });
  if (!quote) return { ok: false as const, message: "Quote not found." };
  if (quote.status !== "draft") return { ok: false as const, message: "Only drafts can be sent. Create a new version to revise a sent quote." };
  const usage = await dayUsage(quote.fulfillmentDate, s);
  if (usage.remaining !== null && usage.remaining < quote.capacityUnits && !opts.force) {
    return { ok: false as const, capacityWarning: true, message: `${quote.fulfillmentDate} only has ${Math.max(0, usage.remaining)} capacity unit(s) free and this quote needs ${quote.capacityUnits}. Tick "send anyway" to send it regardless.` };
  }
  const expiresAt = new Date(Date.now() + s.quoteValidityDays * 86_400_000);
  let id: string | null = null;
  await db().transaction(async (tx) => {
    await tx
      .update(schema.quotes)
      .set({ status: "withdrawn" })
      .where(and(eq(schema.quotes.inquiryId, quote.inquiryId), eq(schema.quotes.status, "sent")));
    const [sent] = await tx.update(schema.quotes).set({ status: "sent", sentAt: new Date(), expiresAt }).where(and(eq(schema.quotes.id, quoteId), eq(schema.quotes.status, "draft"))).returning();
    await tx.update(schema.inquiries).set({ status: "awaiting_customer" }).where(eq(schema.inquiries.id, quote.inquiryId));
    id = await enqueue(tx, {
      kind: "quote.sent",
      dedupeKey: `quote:${quoteId}:sent`,
      to: quote.inquiry.customerEmail,
      email: T.quoteSent({ ...sent, lines: quote.lines }, quote.inquiry, s, quoteLink(sent)),
      replyTo: s.contactEmail,
      related: { type: "inquiry", id: quote.inquiryId },
    });
  });
  await audit(actor, "quote.sent", "inquiry", quote.inquiryId, { quoteId, version: quote.version, forcedOverCapacity: opts.force && usage.remaining !== null && usage.remaining < quote.capacityUnits ? true : undefined });
  await deliverNow([id]);
  return { ok: true as const };
}

export async function withdrawQuote(actor: Actor, quoteId: string) {
  const quote = await db().query.quotes.findFirst({ where: eq(schema.quotes.id, quoteId) });
  if (!quote || !["draft", "sent"].includes(quote.status)) return { ok: false as const, message: "Only drafts and sent quotes can be withdrawn." };
  await db().transaction(async (tx) => {
    await tx.update(schema.quotes).set({ status: "withdrawn" }).where(eq(schema.quotes.id, quoteId));
    await tx
      .update(schema.inquiries)
      .set({ status: "reviewing" })
      .where(and(eq(schema.inquiries.id, quote.inquiryId), inArray(schema.inquiries.status, ["awaiting_customer", "quote_prepared"])));
  });
  await audit(actor, "quote.withdrawn", "inquiry", quote.inquiryId, { quoteId });
  return { ok: true as const };
}

export async function getQuoteForCustomer(reference: string, token: string | undefined) {
  if (!/^QTE-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(reference)) return null;
  const quote = await db().query.quotes.findFirst({ where: eq(schema.quotes.reference, reference), with: { lines: { orderBy: (l, o) => [o.asc(l.sortOrder)] }, inquiry: true } });
  if (!quote || !verifyLinkToken("quote", quote.id, token)) return null;
  const order = await db().query.orders.findFirst({ where: eq(schema.orders.sourceQuoteId, quote.id), columns: { id: true, reference: true } });
  return { ...quote, order: order ? { ...order, link: orderLink(order) } : null };
}

export type AcceptResult = { ok: true; redirectUrl: string } | { ok: false; message: string };

/** Customer accepts a sent, unexpired quote. Idempotent: accepting twice returns the same order. */
export async function acceptQuote(reference: string, token: string | undefined): Promise<AcceptResult> {
  const s = await getSettings();
  const found = await getQuoteForCustomer(reference, token);
  if (!found) return { ok: false, message: "This quote link isn't valid." };
  if (found.status === "accepted" && found.order) return { ok: true, redirectUrl: found.order.link };
  if (found.status !== "sent") return { ok: false, message: "This quote is no longer open." };
  if (found.expiresAt && found.expiresAt < new Date()) {
    await expireQuote(found.id);
    return { ok: false, message: "This quote has expired. Please contact us and we'll check availability again." };
  }

  const provider = paymentProvider();
  let notifyIds: (string | null)[] = [];
  type R = { ok: true; orderId: string } | { ok: false; message: string; full?: boolean };
  const result: R = await db().transaction(async (tx): Promise<R> => {
    const [locked] = await tx.select().from(schema.quotes).where(eq(schema.quotes.id, found.id)).for("update");
    if (locked.status !== "sent") return { ok: false, message: "This quote is no longer open." };
    const inquiry = found.inquiry;
    const [order] = await tx
      .insert(schema.orders)
      .values({
        reference: makeReference("SBS"),
        customerId: inquiry.customerId,
        customerName: inquiry.customerName,
        customerEmail: inquiry.customerEmail,
        customerPhone: inquiry.customerPhone,
        fulfillmentMethod: locked.fulfillmentMethod,
        fulfillmentDate: locked.fulfillmentDate,
        deliveryAddress: locked.fulfillmentMethod === "delivery" ? inquiry.deliveryAddress : null,
        notes: locked.customerMessage,
        subtotalCents: locked.subtotalCents,
        taxCents: locked.taxCents,
        deliveryFeeCents: locked.deliveryFeeCents,
        totalCents: locked.totalCents,
        currency: locked.currency,
        taxRateBps: locked.taxRateBps,
        depositCents: locked.depositCents,
        accessTokenHash: "pending",
        sourceInquiryId: inquiry.id,
        sourceQuoteId: locked.id,
      })
      .returning();
    await tx.update(schema.orders).set({ accessTokenHash: sha256(linkToken("order", order.id)) }).where(eq(schema.orders.id, order.id));
    await tx.insert(schema.orderItems).values(
      found.lines.map((l) => ({ orderId: order.id, productId: inquiry.productId, productName: l.description, options: [], unitPriceCents: l.unitPriceCents, quantity: l.quantity, lineTotalCents: l.lineTotalCents })),
    );
    // Without online payment, hold the date for the quote's validity while staff arrange payment.
    const claim = await claimCapacity(tx, s, {
      date: locked.fulfillmentDate,
      units: locked.capacityUnits,
      orderId: order.id,
      hold: true,
      holdMinutes: provider ? undefined : s.quoteValidityDays * 24 * 60,
    });
    if (!claim.ok) throw new FullyBooked();
    await tx.update(schema.quotes).set({ status: "accepted", respondedAt: new Date() }).where(eq(schema.quotes.id, locked.id));
    await tx.update(schema.inquiries).set({ status: "deposit_required" }).where(eq(schema.inquiries.id, inquiry.id));
    const biz = businessRecipient(s);
    if (biz) {
      notifyIds.push(
        await enqueue(tx, { kind: "quote.accepted_business", dedupeKey: `quote:${locked.id}:accepted`, to: biz, email: T.quoteResponseForBusiness({ ...locked, lines: found.lines }, inquiry, true, s, siteUrl(`/admin/inquiries/${inquiry.id}`)), related: { type: "inquiry", id: inquiry.id } }),
      );
    }
    await audit(SYSTEM_ACTOR, "quote.accepted", "inquiry", inquiry.id, { quoteId: locked.id, orderId: order.id });
    return { ok: true, orderId: order.id };
  }).catch(async (err): Promise<R> => {
    if (!(err instanceof FullyBooked)) throw err;
    // The date filled up after the quote was sent: tell staff so they can follow up.
    const biz = businessRecipient(s);
    if (biz) {
      notifyIds = [
        await enqueue(db(), {
          kind: "quote.accept_blocked_business",
          dedupeKey: `quote:${found.id}:accept_blocked:${new Date().toISOString().slice(0, 13)}`,
          to: biz,
          email: T.quoteResponseForBusiness(found, found.inquiry, true, s, siteUrl(`/admin/inquiries/${found.inquiryId}`), `The customer tried to accept, but ${found.fulfillmentDate} is now fully booked. Please contact them.`),
          related: { type: "inquiry", id: found.inquiryId },
        }),
      ];
    }
    await db().update(schema.inquiries).set({ status: "reviewing" }).where(eq(schema.inquiries.id, found.inquiryId));
    return { ok: false, message: "Sorry — that date has just filled up. We've let the team know and they'll contact you about options." };
  });
  await deliverNow(notifyIds);
  if (!result.ok) return result;

  const order = (await db().query.orders.findFirst({ where: eq(schema.orders.id, result.orderId) }))!;
  if (!provider) return { ok: true, redirectUrl: orderLink(order) };
  const pay = await startOrderPayment(order.id);
  if (!pay.ok) {
    log.warn("quote.accept_payment_start_failed", { orderId: order.id, message: pay.message });
    return { ok: true, redirectUrl: orderLink(order) };
  }
  return { ok: true, redirectUrl: pay.url };
}

class FullyBooked extends Error {}

export async function declineQuote(reference: string, token: string | undefined, reason: string | null) {
  const s = await getSettings();
  const found = await getQuoteForCustomer(reference, token);
  if (!found) return { ok: false as const, message: "This quote link isn't valid." };
  if (found.status !== "sent") return { ok: false as const, message: "This quote is no longer open." };
  let id: string | null = null;
  await db().transaction(async (tx) => {
    const [q] = await tx
      .update(schema.quotes)
      .set({ status: "declined", respondedAt: new Date(), declineReason: reason?.slice(0, 1000) || null })
      .where(and(eq(schema.quotes.id, found.id), eq(schema.quotes.status, "sent")))
      .returning();
    if (!q) return;
    await tx.update(schema.inquiries).set({ status: "declined" }).where(eq(schema.inquiries.id, found.inquiryId));
    const biz = businessRecipient(s);
    if (biz) {
      id = await enqueue(tx, { kind: "quote.declined_business", dedupeKey: `quote:${found.id}:declined`, to: biz, email: T.quoteResponseForBusiness(found, found.inquiry, false, s, siteUrl(`/admin/inquiries/${found.inquiryId}`), reason), related: { type: "inquiry", id: found.inquiryId } });
    }
  });
  await audit(SYSTEM_ACTOR, "quote.declined", "inquiry", found.inquiryId, { quoteId: found.id, reason });
  await deliverNow([id]);
  return { ok: true as const };
}

async function expireQuote(quoteId: string): Promise<string | null> {
  const s = await getSettings();
  return db().transaction(async (tx) => {
    const [q] = await tx.update(schema.quotes).set({ status: "expired" }).where(and(eq(schema.quotes.id, quoteId), eq(schema.quotes.status, "sent"))).returning();
    if (!q) return null;
    const inquiry = (await tx.query.inquiries.findFirst({ where: eq(schema.inquiries.id, q.inquiryId) }))!;
    if (inquiry.status === "awaiting_customer") await tx.update(schema.inquiries).set({ status: "expired" }).where(eq(schema.inquiries.id, inquiry.id));
    const lines = await tx.query.quoteLines.findMany({ where: eq(schema.quoteLines.quoteId, q.id) });
    await audit(SYSTEM_ACTOR, "quote.expired", "inquiry", inquiry.id, { quoteId });
    return enqueue(tx, { kind: "quote.expired", dedupeKey: `quote:${q.id}:expired`, to: inquiry.customerEmail, email: T.quoteExpired({ ...q, lines }, inquiry, s), replyTo: s.contactEmail, related: { type: "inquiry", id: inquiry.id } });
  });
}

/** Job: expire sent quotes past their expiry. */
export async function expireQuotes(): Promise<number> {
  const due = await db().query.quotes.findMany({ where: and(eq(schema.quotes.status, "sent"), lt(schema.quotes.expiresAt, new Date())), columns: { id: true } });
  const ids: (string | null)[] = [];
  for (const q of due) ids.push(await expireQuote(q.id));
  await deliverNow(ids);
  return due.length;
}

export async function quotesForInquiry(inquiryId: string) {
  return db().query.quotes.findMany({ where: eq(schema.quotes.inquiryId, inquiryId), with: { lines: { orderBy: (l, o) => [o.asc(l.sortOrder)] } }, orderBy: [desc(schema.quotes.version)] });
}
