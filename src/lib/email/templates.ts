import type { schema } from "@/db";
import { formatDate } from "@/lib/dates";
import { siteUrl } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import type { SiteSettings } from "@/lib/settings";
import type { EmailMessage } from "./index";

type Order = typeof schema.orders.$inferSelect & { items: (typeof schema.orderItems.$inferSelect)[] };
type Inquiry = typeof schema.inquiries.$inferSelect;

function orderLines(order: Order) {
  const lines = order.items.map((i) => {
    const opts = i.options.length ? ` (${i.options.map((o) => `${o.option}: ${o.value}`).join(", ")})` : "";
    return `  ${i.quantity} × ${i.productName}${opts} — ${formatMoney(i.lineTotalCents, order.currency)}`;
  });
  lines.push(`  Subtotal: ${formatMoney(order.subtotalCents, order.currency)}`);
  if (order.deliveryFeeCents) lines.push(`  Delivery: ${formatMoney(order.deliveryFeeCents, order.currency)}`);
  lines.push(`  Tax: ${formatMoney(order.taxCents, order.currency)}`);
  lines.push(`  Total paid: ${formatMoney(order.totalCents, order.currency)}`);
  return lines.join("\n");
}

function fulfillment(order: Order) {
  const when = formatDate(order.fulfillmentDate);
  if (order.fulfillmentMethod === "pickup") return `Pickup on ${when}`;
  const a = order.deliveryAddress;
  return `Delivery on ${when}${a ? ` to ${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city}, ${a.region} ${a.postalCode}` : ""}`;
}

export function orderConfirmationEmail(order: Order, s: SiteSettings): EmailMessage {
  const text = [
    `Hi ${order.customerName},`,
    "",
    `Thank you for your order with ${s.businessName}! Your payment has been received.`,
    "",
    `Order reference: ${order.reference}`,
    fulfillment(order),
    "",
    orderLines(order),
    "",
    order.fulfillmentMethod === "pickup" && s.pickupInstructions ? `Pickup details: ${s.pickupInstructions}\n` : "",
    "We'll be in touch if we have any questions about your order.",
    s.contactEmail ? `Questions? Reply to this email or write to ${s.contactEmail}.` : "",
    "",
    s.businessName,
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { to: order.customerEmail, subject: `Your ${s.businessName} order ${order.reference}`, text, replyTo: s.contactEmail ?? undefined };
}

export function orderNotificationEmail(order: Order, to: string): EmailMessage {
  const text = [
    `New paid order ${order.reference}`,
    "",
    `Customer: ${order.customerName} <${order.customerEmail}>${order.customerPhone ? `, ${order.customerPhone}` : ""}`,
    fulfillment(order),
    order.notes ? `Notes: ${order.notes}` : "",
    "",
    orderLines(order),
    "",
    `Manage: ${siteUrl(`/admin/orders/${order.id}`)}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { to, subject: `New order ${order.reference} — ${formatDate(order.fulfillmentDate)}`, text, replyTo: order.customerEmail };
}

function inquirySummary(i: Inquiry) {
  return [
    `Event date: ${formatDate(i.eventDate)}`,
    `Occasion: ${i.eventType}`,
    `Requested: ${i.productType}`,
    i.servings ? `Servings / quantity: ${i.servings}` : "",
    i.tiers ? `Tiers: ${i.tiers}` : "",
    i.size ? `Size: ${i.size}` : "",
    i.flavours ? `Flavours: ${i.flavours}` : "",
    `Design: ${i.design}`,
    i.theme ? `Theme: ${i.theme}` : "",
    i.colours ? `Colours: ${i.colours}` : "",
    i.message ? `Inscription: ${i.message}` : "",
    `Fulfilment: ${i.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"}`,
    i.allergies ? `Allergies / dietary: ${i.allergies}` : "",
    i.budget ? `Budget: ${i.budget}` : "",
    i.details ? `Other details: ${i.details}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function inquiryAcknowledgementEmail(i: Inquiry, s: SiteSettings): EmailMessage {
  const text = [
    `Hi ${i.customerName},`,
    "",
    `Thanks for your custom order request with ${s.businessName}. Your reference is ${i.reference}.`,
    "",
    "Please note: this is a request, not a confirmed order. We'll review the details and get back to you about availability and pricing. Your date is only booked once we confirm it with you.",
    "",
    "Here's what you sent us:",
    inquirySummary(i),
    "",
    s.businessName,
  ].join("\n");
  return { to: i.customerEmail, subject: `We received your request (${i.reference})`, text, replyTo: s.contactEmail ?? undefined };
}

export function inquiryNotificationEmail(i: Inquiry, to: string, attachmentCount: number): EmailMessage {
  const text = [
    `New custom order request ${i.reference}`,
    "",
    `From: ${i.customerName} <${i.customerEmail}>${i.customerPhone ? `, ${i.customerPhone}` : ""}`,
    inquirySummary(i),
    attachmentCount ? `\n${attachmentCount} inspiration image(s) attached — view them in the admin.` : "",
    "",
    `Review: ${siteUrl(`/admin/inquiries/${i.id}`)}`,
  ].join("\n");
  return { to, subject: `Custom request ${i.reference} — ${i.eventType}, ${formatDate(i.eventDate)}`, text, replyTo: i.customerEmail };
}

export function quoteEmail(i: Inquiry, s: SiteSettings, priceCents: number, paymentUrl: string | null): EmailMessage {
  const text = [
    `Hi ${i.customerName},`,
    "",
    `Thank you for your patience. Here is our quote for your request ${i.reference}:`,
    "",
    `Price: ${formatMoney(priceCents, s.currency)}`,
    i.quoteNotes ? `Details: ${i.quoteNotes}` : "",
    `Date: ${formatDate(i.eventDate)}`,
    "",
    paymentUrl ? `To confirm your order, please complete payment here: ${paymentUrl}` : "Reply to this email to confirm and we'll arrange payment.",
    "",
    s.businessName,
  ]
    .filter((l) => l !== null)
    .join("\n");
  return { to: i.customerEmail, subject: `Your quote from ${s.businessName} (${i.reference})`, text, replyTo: s.contactEmail ?? undefined };
}
