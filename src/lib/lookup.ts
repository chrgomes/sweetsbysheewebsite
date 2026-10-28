import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/dates";
import { inquiryLink, orderLink, quoteLink } from "@/lib/links";
import { deliverNow, enqueue } from "@/lib/notifications";
import * as T from "@/lib/notifications/templates";
import { getSettings } from "@/lib/settings";

/**
 * "Find my orders": email fresh links for a customer's recent orders, requests
 * and quotes to the address on file. The caller always shows the same message
 * whether or not the email exists, so it can't be used to discover customers.
 */
export async function sendLookupEmail(email: string) {
  const s = await getSettings();
  const customer = await db().query.customers.findFirst({ where: eq(schema.customers.email, email.trim().toLowerCase()) });
  if (!customer || customer.erasedAt) return;
  const [orders, inquiries] = await Promise.all([
    db().query.orders.findMany({ where: eq(schema.orders.customerId, customer.id), orderBy: [desc(schema.orders.createdAt)], limit: 10 }),
    db().query.inquiries.findMany({ where: eq(schema.inquiries.customerId, customer.id), orderBy: [desc(schema.inquiries.createdAt)], limit: 10, with: { quotes: true } }),
  ]);
  const items: { label: string; url: string }[] = [
    ...orders.map((o) => ({ label: `Order ${o.reference} (${formatDate(o.fulfillmentDate)})`, url: orderLink(o) })),
    ...inquiries.map((i) => ({ label: `Request ${i.reference} (${formatDate(i.eventDate)})`, url: inquiryLink(i) })),
    ...inquiries.flatMap((i) => i.quotes.filter((q) => q.status === "sent").map((q) => ({ label: `Quote ${q.reference}`, url: quoteLink(q) }))),
  ];
  if (!items.length) return;
  // One lookup email per customer per 10 minutes, even if asked repeatedly.
  const slot = Math.floor(Date.now() / 600_000);
  const id = await enqueue(db(), { kind: "lookup.links", dedupeKey: `lookup:${customer.id}:${slot}`, to: customer.email, email: T.lookupLinks(s, items), related: { type: "customer", id: customer.id } });
  await deliverNow([id]);
}
