import "server-only";
import { and, count, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, dateInZone, startOfDayInZone } from "@/lib/dates";
import type { SiteSettings } from "@/lib/settings";

/**
 * Dashboard metrics. Definitions are documented in docs/reporting.md; keep the
 * two in sync. All date ranges are calendar days in the bakery's timezone.
 */
export type RangeKey = "today" | "7d" | "30d" | "month";

export function rangeBounds(key: RangeKey, s: SiteSettings, now = new Date()) {
  const today = dateInZone(now, s.timezone);
  const fromDate = key === "today" ? today : key === "7d" ? addDays(today, -6) : key === "30d" ? addDays(today, -29) : `${today.slice(0, 8)}01`;
  return { fromDate, toDate: today, from: startOfDayInZone(fromDate, s.timezone), to: startOfDayInZone(addDays(today, 1), s.timezone) };
}

export async function salesSummary(key: RangeKey, s: SiteSettings) {
  const { from, to, fromDate, toDate } = rangeBounds(key, s);
  // Cash basis: money actually received and refunded in the range, by when it happened.
  const [received] = await db()
    .select({ cents: sql<number>`coalesce(sum(${schema.payments.amountCents}), 0)::int`, n: count() })
    .from(schema.payments)
    .where(and(eq(schema.payments.status, "succeeded"), gte(schema.payments.succeededAt, from), lt(schema.payments.succeededAt, to)));
  const [refunded] = await db()
    .select({ cents: sql<number>`coalesce(sum(${schema.refunds.amountCents}), 0)::int` })
    .from(schema.refunds)
    .where(and(eq(schema.refunds.status, "succeeded"), gte(schema.refunds.completedAt, from), lt(schema.refunds.completedAt, to)));
  // Orders confirmed in the range: their first successful payment falls in it.
  const firstPaid = db()
    .select({ orderId: schema.payments.orderId, first: sql<Date>`min(${schema.payments.succeededAt})`.as("first") })
    .from(schema.payments)
    .where(eq(schema.payments.status, "succeeded"))
    .groupBy(schema.payments.orderId)
    .as("first_paid");
  const [confirmed] = await db()
    .select({
      n: count(),
      totalCents: sql<number>`coalesce(sum(${schema.orders.totalCents}), 0)::int`,
      salesCents: sql<number>`coalesce(sum(${schema.orders.subtotalCents} - ${schema.orders.discountCents}), 0)::int`,
      taxCents: sql<number>`coalesce(sum(${schema.orders.taxCents}), 0)::int`,
      discountCents: sql<number>`coalesce(sum(${schema.orders.discountCents}), 0)::int`,
    })
    .from(firstPaid)
    .innerJoin(schema.orders, eq(schema.orders.id, firstPaid.orderId))
    .where(and(sql`${firstPaid.first} >= ${from.toISOString()}::timestamptz`, sql`${firstPaid.first} < ${to.toISOString()}::timestamptz`));
  return {
    fromDate,
    toDate,
    receivedCents: received.cents,
    paymentsCount: received.n,
    refundedCents: refunded.cents,
    netCents: received.cents - refunded.cents,
    ordersConfirmed: confirmed.n,
    orderValueCents: confirmed.totalCents,
    salesCents: confirmed.salesCents,
    taxCents: confirmed.taxCents,
    discountCents: confirmed.discountCents,
    averageOrderCents: confirmed.n ? Math.round(confirmed.totalCents / confirmed.n) : 0,
  };
}

export async function operationsSummary(s: SiteSettings) {
  const today = dateInZone(new Date(), s.timezone);
  const week = addDays(today, 7);
  const active = ["confirmed", "in_production", "ready"] as const;
  const [newInquiries, quotesOut, toStart, failedEmails, pendingRefunds] = await Promise.all([
    db().select({ n: count() }).from(schema.inquiries).where(eq(schema.inquiries.status, "new")),
    db()
      .select({ n: count(), cents: sql<number>`coalesce(sum(${schema.quotes.totalCents}), 0)::int` })
      .from(schema.quotes)
      .where(eq(schema.quotes.status, "sent")),
    db()
      .select({ n: count() })
      .from(schema.orders)
      .where(and(eq(schema.orders.status, "confirmed"), lte(schema.orders.fulfillmentDate, addDays(today, 3)))),
    db().select({ n: count() }).from(schema.notifications).where(eq(schema.notifications.status, "failed")),
    db().select({ n: count() }).from(schema.refunds).where(eq(schema.refunds.status, "pending")),
  ]);
  const [balances] = await db()
    .select({ n: count(), cents: sql<number>`coalesce(sum(${schema.orders.totalCents} - ${schema.orders.amountPaidCents}), 0)::int` })
    .from(schema.orders)
    .where(and(eq(schema.orders.paymentStatus, "deposit_paid"), inArray(schema.orders.status, [...active, "on_hold"])));
  const upcoming = await db().query.orders.findMany({
    where: and(inArray(schema.orders.status, [...active]), gte(schema.orders.fulfillmentDate, today), lte(schema.orders.fulfillmentDate, week)),
    with: { items: true },
    orderBy: [schema.orders.fulfillmentDate, schema.orders.fulfillmentWindow],
    limit: 20,
  });
  const activity = await db().query.auditLog.findMany({ orderBy: [desc(schema.auditLog.createdAt)], limit: 8 });
  return {
    newInquiries: newInquiries[0].n,
    quotesOutstanding: quotesOut[0].n,
    quotesOutstandingCents: quotesOut[0].cents,
    ordersToStart: toStart[0].n,
    balancesDue: balances.n,
    balancesDueCents: balances.cents,
    failedEmails: failedEmails[0].n,
    pendingRefunds: pendingRefunds[0].n,
    upcoming,
    activity,
  };
}
