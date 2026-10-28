import "server-only";
import { and, count, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, dateInZone, startOfDayInZone } from "@/lib/dates";
import { productCosts, withScales } from "@/lib/inventory";
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

/* ------------------------------------------------------------------ */
/* Product sales                                                       */
/* ------------------------------------------------------------------ */

/**
 * Sales by product for orders confirmed (first successful payment) between two
 * dates, excluding orders later cancelled. Revenue is line totals, before
 * order-level discounts, tax and delivery. Estimated ingredient cost uses
 * current recipe costs (with option scaling), so it changes when prices do.
 * See docs/reporting.md.
 */
export async function productSales(fromDate: string, toDate: string, s: SiteSettings) {
  const from = startOfDayInZone(fromDate, s.timezone);
  const to = startOfDayInZone(addDays(toDate, 1), s.timezone);
  const firstPaid = db()
    .select({ orderId: schema.payments.orderId, first: sql<string>`min(${schema.payments.succeededAt})`.as("first") })
    .from(schema.payments)
    .where(eq(schema.payments.status, "succeeded"))
    .groupBy(schema.payments.orderId)
    .as("first_paid");
  const confirmed = await db()
    .select({ id: schema.orders.id, first: firstPaid.first, sourceQuoteId: schema.orders.sourceQuoteId })
    .from(firstPaid)
    .innerJoin(schema.orders, eq(schema.orders.id, firstPaid.orderId))
    .where(and(sql`${firstPaid.first} >= ${from.toISOString()}::timestamptz`, sql`${firstPaid.first} < ${to.toISOString()}::timestamptz`, sql`${schema.orders.status} <> 'cancelled'`));
  const ids = confirmed.map((o) => o.id);
  const items = ids.length ? await db().query.orderItems.findMany({ where: inArray(schema.orderItems.orderId, ids) }) : [];
  const fromQuote = new Set(confirmed.filter((o) => o.sourceQuoteId).map((o) => o.id));

  // Quote lines are free text, so custom orders are reported as one row.
  const shopItems = items.filter((i) => !fromQuote.has(i.orderId));
  const scaled = await withScales(db(), shopItems);
  const costs = await productCosts([...new Set(shopItems.map((i) => i.productId).filter((x): x is string => !!x))]);

  type Row = { key: string; productId: string | null; name: string; orders: Set<string>; units: number; revenueCents: number; costCents: number; costKnown: boolean };
  const rows = new Map<string, Row>();
  const row = (key: string, productId: string | null, name: string) => {
    if (!rows.has(key)) rows.set(key, { key, productId, name, orders: new Set(), units: 0, revenueCents: 0, costCents: 0, costKnown: true });
    return rows.get(key)!;
  };
  for (const i of scaled) {
    const r = row(i.productId ?? `name:${i.productName}`, i.productId, i.productName);
    r.orders.add(i.orderId);
    r.units += i.quantity;
    r.revenueCents += i.lineTotalCents;
    const c = i.productId ? costs.get(i.productId) : undefined;
    if (c && c.cents !== null && c.missing.length === 0) r.costCents += c.cents * i.scale * i.quantity;
    else r.costKnown = false;
  }
  for (const i of items.filter((x) => fromQuote.has(x.orderId))) {
    const r = row("custom-quotes", null, "Custom orders (quotes)");
    r.orders.add(i.orderId);
    r.units += i.quantity;
    r.revenueCents += i.lineTotalCents;
    r.costKnown = false;
  }

  // Daily revenue (line totals) by confirmation day, every day in the range.
  const dayOf = new Map(confirmed.map((o) => [o.id, dateInZone(new Date(o.first), s.timezone)]));
  const daily = new Map<string, { revenueCents: number; orders: Set<string> }>();
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) daily.set(d, { revenueCents: 0, orders: new Set() });
  for (const i of items) {
    const d = daily.get(dayOf.get(i.orderId)!);
    if (!d) continue;
    d.revenueCents += i.lineTotalCents;
    d.orders.add(i.orderId);
  }

  const products = [...rows.values()]
    .map((r) => ({
      key: r.key,
      productId: r.productId,
      name: r.name,
      orders: r.orders.size,
      units: r.units,
      revenueCents: r.revenueCents,
      costCents: r.costKnown ? Math.round(r.costCents) : null,
      marginCents: r.costKnown ? r.revenueCents - Math.round(r.costCents) : null,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name));
  return {
    fromDate,
    toDate,
    orders: confirmed.length,
    revenueCents: products.reduce((n, p) => n + p.revenueCents, 0),
    products,
    daily: [...daily].map(([date, d]) => ({ date, revenueCents: d.revenueCents, orders: d.orders.size })),
  };
}
