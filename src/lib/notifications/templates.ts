import type { schema } from "@/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { SiteSettings } from "@/lib/settings";
import { renderEmail, type Block, type RenderedEmail } from "./layout";

/**
 * Every email the system sends. Each returns subject, text and HTML through the
 * shared branded layout, which escapes all values.
 */
type Order = typeof schema.orders.$inferSelect & { items: (typeof schema.orderItems.$inferSelect)[] };
type Inquiry = typeof schema.inquiries.$inferSelect;
type Quote = typeof schema.quotes.$inferSelect & { lines: (typeof schema.quoteLines.$inferSelect)[] };

const money = (cents: number, currency: string) => formatMoney(cents, currency);

function fulfilment(o: { fulfillmentMethod: string; fulfillmentDate: string; fulfillmentWindow?: string | null; deliveryAddress?: schema.DeliveryAddress | null }) {
  const when = `${formatDate(o.fulfillmentDate)}${o.fulfillmentWindow ? `, ${o.fulfillmentWindow}` : ""}`;
  if (o.fulfillmentMethod === "pickup") return `Pickup on ${when}`;
  const a = o.deliveryAddress;
  return `Delivery on ${when}${a ? ` to ${[a.line1, a.line2, `${a.city}, ${a.region} ${a.postalCode}`].filter(Boolean).join(", ")}` : ""}`;
}

function orderLines(o: Order): Block {
  const totals: [string, string][] = [["Subtotal", money(o.subtotalCents, o.currency)]];
  if (o.discountCents) totals.push([`Discount${o.discountCode ? ` (${o.discountCode})` : ""}`, `−${money(o.discountCents, o.currency)}`]);
  if (o.deliveryFeeCents) totals.push(["Delivery", money(o.deliveryFeeCents, o.currency)]);
  totals.push(["Tax", money(o.taxCents, o.currency)], ["Total", money(o.totalCents, o.currency)]);
  return {
    type: "lines",
    lines: o.items.map((i) => ({
      label: `${i.quantity} × ${i.productName}`,
      detail: i.options.map((x) => `${x.option}: ${x.value}`).join(" · ") || undefined,
      amount: money(i.lineTotalCents, o.currency),
    })),
    totals,
  };
}

const contactLine = (s: SiteSettings) => (s.contactEmail ? `Questions? Reply to this email or write to ${s.contactEmail}.` : "Questions? Just reply to this email.");

/* Orders ----------------------------------------------------------------- */

export function orderConfirmed(o: Order, s: SiteSettings, link: string): RenderedEmail {
  const balance = o.totalCents - o.amountPaidCents + o.amountRefundedCents;
  const blocks: Block[] = [
    { type: "p", text: `Hi ${o.customerName}, thank you for your order! ${o.paymentStatus === "deposit_paid" ? "Your deposit has been received and your date is booked." : "Your payment has been received and your order is confirmed."}` },
    { type: "rows", rows: [["Order", o.reference], ["When", fulfilment(o)]] },
    orderLines(o),
  ];
  if (o.paymentStatus === "deposit_paid" && balance > 0) {
    blocks.push({ type: "note", text: `Deposit paid: ${money(o.amountPaidCents, o.currency)}. Remaining balance: ${money(balance, o.currency)}, due ${s.balanceDueDaysBefore} day(s) before your date. We'll send a reminder.` });
  }
  if (o.fulfillmentMethod === "pickup" && s.pickupInstructions) blocks.push({ type: "note", text: `Pickup details: ${s.pickupInstructions}` });
  blocks.push({ type: "button", label: "View your order", url: link }, { type: "p", text: contactLine(s) });
  return renderEmail({ subject: `Your ${s.businessName} order ${o.reference} is confirmed`, preheader: fulfilment(o), heading: "Your order is confirmed", blocks, businessName: s.businessName });
}

export function newOrderForBusiness(o: Order, s: SiteSettings, adminLink: string): RenderedEmail {
  return renderEmail({
    subject: `New order ${o.reference} — ${formatDate(o.fulfillmentDate)}`,
    heading: `New order ${o.reference}`,
    businessName: s.businessName,
    blocks: [
      {
        type: "rows",
        rows: [
          ["Customer", `${o.customerName} <${o.customerEmail}>${o.customerPhone ? `, ${o.customerPhone}` : ""}`],
          ["When", fulfilment(o)],
          ["Payment", o.paymentStatus === "deposit_paid" ? `Deposit paid (${money(o.amountPaidCents, o.currency)})` : `Paid (${money(o.amountPaidCents, o.currency)})`],
          ...(o.notes ? ([["Notes", o.notes]] as [string, string][]) : []),
        ],
      },
      orderLines(o),
      { type: "button", label: "Open in admin", url: adminLink },
    ],
  });
}

export function paymentFailed(o: Order, s: SiteSettings, link: string): RenderedEmail {
  return renderEmail({
    subject: `Payment for order ${o.reference} didn't go through`,
    heading: "Your payment didn't go through",
    businessName: s.businessName,
    blocks: [
      { type: "p", text: `Hi ${o.customerName}, the payment for order ${o.reference} wasn't completed, so the order isn't confirmed yet and no money was taken.` },
      { type: "button", label: "View your order", url: link },
      { type: "p", text: contactLine(s) },
    ],
  });
}

const STATUS_COPY: Record<string, { subject: string; heading: string; text: (o: Order) => string }> = {
  in_production: {
    subject: "is being prepared",
    heading: "We're making your order",
    text: (o) => `Good news — we've started on order ${o.reference}.`,
  },
  ready: {
    subject: "is ready",
    heading: "Your order is ready",
    text: (o) => (o.fulfillmentMethod === "pickup" ? `Order ${o.reference} is ready for pickup.` : `Order ${o.reference} is ready and will be on its way for delivery.`),
  },
  completed: {
    subject: "is complete",
    heading: "Thank you!",
    text: (o) => `Order ${o.reference} is complete. We hope you enjoy every bite.`,
  },
};

export function orderStatusUpdate(o: Order, status: string, s: SiteSettings, link: string): RenderedEmail | null {
  const copy = STATUS_COPY[status];
  if (!copy) return null;
  const blocks: Block[] = [{ type: "p", text: `Hi ${o.customerName}, ${copy.text(o)}` }, { type: "rows", rows: [["When", fulfilment(o)]] }];
  if (status === "ready" && o.fulfillmentMethod === "pickup" && s.pickupInstructions) blocks.push({ type: "note", text: `Pickup details: ${s.pickupInstructions}` });
  blocks.push({ type: "button", label: "View your order", url: link });
  return renderEmail({ subject: `Your order ${o.reference} ${copy.subject}`, heading: copy.heading, blocks, businessName: s.businessName });
}

export function orderCancelled(o: Order, s: SiteSettings, link: string, reason: string | null): RenderedEmail {
  const blocks: Block[] = [{ type: "p", text: `Hi ${o.customerName}, order ${o.reference} has been cancelled.` }];
  if (reason) blocks.push({ type: "note", text: reason });
  if (o.amountPaidCents - o.amountRefundedCents > 0) blocks.push({ type: "p", text: "If a refund is due, we'll email you as soon as it has been issued." });
  blocks.push({ type: "button", label: "View your order", url: link }, { type: "p", text: contactLine(s) });
  return renderEmail({ subject: `Order ${o.reference} cancelled`, heading: "Your order has been cancelled", blocks, businessName: s.businessName });
}

export function refundIssued(o: Order, amountCents: number, s: SiteSettings, link: string): RenderedEmail {
  return renderEmail({
    subject: `Refund for order ${o.reference}`,
    heading: "Your refund is on its way",
    businessName: s.businessName,
    blocks: [
      { type: "p", text: `Hi ${o.customerName}, we've refunded ${money(amountCents, o.currency)} for order ${o.reference}. Depending on your bank it can take 5–10 business days to appear.` },
      { type: "button", label: "View your order", url: link },
    ],
  });
}

export function balanceReminder(o: Order, s: SiteSettings, link: string): RenderedEmail {
  const due = o.totalCents - o.amountPaidCents + o.amountRefundedCents;
  return renderEmail({
    subject: `Balance due for order ${o.reference}`,
    heading: "Your remaining balance",
    businessName: s.businessName,
    blocks: [
      { type: "p", text: `Hi ${o.customerName}, your order is coming up soon. The remaining balance is ${money(due, o.currency)}.` },
      { type: "rows", rows: [["When", fulfilment(o)]] },
      { type: "button", label: "Pay the balance", url: link },
      { type: "p", text: contactLine(s) },
    ],
  });
}

/* Custom requests and quotes ---------------------------------------------- */

function inquirySummary(i: Inquiry): [string, string][] {
  const rows: [string, string | null | undefined][] = [
    ["Event date", formatDate(i.eventDate)],
    ["Occasion", i.eventType],
    ["Requested", i.productType],
    ["Servings / quantity", i.servings?.toString()],
    ["Tiers", i.tiers?.toString()],
    ["Size", i.size],
    ["Flavours", i.flavours],
    ["Design", i.design],
    ["Theme", i.theme],
    ["Colours", i.colours],
    ["Inscription", i.message],
    ["Fulfilment", i.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"],
    ["Allergies / dietary", i.allergies],
    ["Budget", i.budget],
    ["Preferred contact", i.preferredContact],
    ["Other details", i.details],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

export function inquiryReceived(i: Inquiry, s: SiteSettings, link: string): RenderedEmail {
  return renderEmail({
    subject: `We received your request (${i.reference})`,
    heading: "Thanks — we've got your request",
    businessName: s.businessName,
    blocks: [
      { type: "p", text: `Hi ${i.customerName}, thank you for your custom order request. Your reference is ${i.reference}.` },
      { type: "note", text: `This is a request, not a confirmed order. We'll review the details and reply about availability and pricing. Your date is only booked once ${s.businessName} confirms it with you.` },
      { type: "rows", rows: inquirySummary(i) },
      { type: "button", label: "View your request", url: link },
    ],
  });
}

export function newInquiryForBusiness(i: Inquiry, s: SiteSettings, adminLink: string, attachments: number): RenderedEmail {
  return renderEmail({
    subject: `Custom request ${i.reference} — ${i.eventType}, ${formatDate(i.eventDate)}`,
    heading: `New custom request ${i.reference}`,
    businessName: s.businessName,
    blocks: [
      { type: "rows", rows: [["From", `${i.customerName} <${i.customerEmail}>${i.customerPhone ? `, ${i.customerPhone}` : ""}`], ...inquirySummary(i)] },
      ...(attachments ? ([{ type: "p", text: `${attachments} inspiration photo(s) attached — view them in the admin.` }] as Block[]) : []),
      { type: "button", label: "Review the request", url: adminLink },
    ],
  });
}

function quoteLinesBlock(q: Quote): Block {
  const totals: [string, string][] = [["Subtotal", money(q.subtotalCents, q.currency)]];
  if (q.deliveryFeeCents) totals.push(["Delivery", money(q.deliveryFeeCents, q.currency)]);
  totals.push(["Tax", money(q.taxCents, q.currency)], ["Total", money(q.totalCents, q.currency)]);
  return {
    type: "lines",
    lines: q.lines.map((l) => ({ label: `${l.quantity} × ${l.description}`, amount: money(l.lineTotalCents, q.currency) })),
    totals,
  };
}

export function quoteSent(q: Quote, i: Inquiry, s: SiteSettings, link: string): RenderedEmail {
  const blocks: Block[] = [
    { type: "p", text: `Hi ${i.customerName}, thank you for your patience. Here's our quote for request ${i.reference}.` },
    { type: "rows", rows: [["Quote", q.reference], ["When", `${q.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"} on ${formatDate(q.fulfillmentDate)}`]] },
    quoteLinesBlock(q),
  ];
  if (q.customerMessage) blocks.push({ type: "note", text: q.customerMessage });
  blocks.push({
    type: "p",
    text: `${q.depositCents > 0 ? `A deposit of ${money(q.depositCents, q.currency)} confirms your booking; the balance is due before your date.` : "Full payment confirms your booking."}${q.expiresAt ? ` This quote is valid until ${formatDate(q.expiresAt.toISOString().slice(0, 10))}.` : ""}`,
  });
  blocks.push({ type: "button", label: "Review and respond", url: link }, { type: "p", text: contactLine(s) });
  return renderEmail({ subject: `Your quote from ${s.businessName} (${i.reference})`, heading: "Your quote is ready", blocks, businessName: s.businessName });
}

export function quoteResponseForBusiness(q: Quote, i: Inquiry, accepted: boolean, s: SiteSettings, adminLink: string, reason?: string | null): RenderedEmail {
  return renderEmail({
    subject: `Quote ${q.reference} ${accepted ? "accepted" : "declined"} — ${i.customerName}`,
    heading: `Quote ${accepted ? "accepted" : "declined"}`,
    businessName: s.businessName,
    blocks: [
      { type: "rows", rows: [["Request", i.reference], ["Customer", `${i.customerName} <${i.customerEmail}>`], ["Total", money(q.totalCents, q.currency)], ...(reason ? ([["Reason", reason]] as [string, string][]) : [])] },
      { type: "button", label: "Open in admin", url: adminLink },
    ],
  });
}

export function quoteExpired(q: Quote, i: Inquiry, s: SiteSettings): RenderedEmail {
  return renderEmail({
    subject: `Your quote ${q.reference} has expired`,
    heading: "Your quote has expired",
    businessName: s.businessName,
    blocks: [
      { type: "p", text: `Hi ${i.customerName}, the quote for request ${i.reference} has expired, so the date isn't held. If you'd still like to go ahead, reply to this email and we'll check availability.` },
    ],
  });
}

/* Lookups ------------------------------------------------------------------ */

export function lookupLinks(s: SiteSettings, items: { label: string; url: string }[]): RenderedEmail {
  return renderEmail({
    subject: `Your ${s.businessName} orders and requests`,
    heading: "Your orders and requests",
    businessName: s.businessName,
    blocks: [
      { type: "p", text: "Here are links to your recent orders, requests and quotes:" },
      { type: "rows", rows: items.map((it) => [it.label, it.url] as [string, string]) },
      { type: "note", text: "If you didn't ask for this email, you can ignore it." },
    ],
  });
}
