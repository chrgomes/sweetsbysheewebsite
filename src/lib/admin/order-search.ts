import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { isIsoDate } from "@/lib/dates";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, type OrderStatus } from "@/lib/orders";

export const ORDER_FILTERS = [
  { key: "open", label: "To fulfil", statuses: ["confirmed", "in_production", "ready", "on_hold"] },
  { key: "pending", label: "Awaiting payment", statuses: ["pending"] },
  { key: "balance", label: "Balance due", statuses: ["confirmed", "in_production", "ready", "on_hold"] },
  { key: "completed", label: "Completed", statuses: ["completed"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
  { key: "all", label: "All", statuses: [] },
] as const satisfies readonly { key: string; label: string; statuses: readonly OrderStatus[] }[];

export type OrderQuery = { filter: (typeof ORDER_FILTERS)[number]; q: string; from: string; to: string };

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function parseOrderQuery(sp: Record<string, string | string[] | undefined>): OrderQuery {
  return {
    filter: ORDER_FILTERS.find((f) => f.key === sp.status) ?? ORDER_FILTERS[0],
    q: str(sp.q).trim().slice(0, 100),
    from: isIsoDate(str(sp.from)) ? str(sp.from) : "",
    to: isIsoDate(str(sp.to)) ? str(sp.to) : "",
  };
}

export function orderQueryString(q: OrderQuery, overrides: Partial<Record<"status" | "q" | "from" | "to", string>> = {}) {
  const params = new URLSearchParams({ status: q.filter.key, q: q.q, from: q.from, to: q.to, ...overrides });
  for (const [k, v] of [...params]) if (!v) params.delete(k);
  return params.toString();
}

export async function searchOrders(q: OrderQuery, limit = 200) {
  const where: SQL[] = [];
  if (q.filter.statuses.length) where.push(inArray(schema.orders.status, [...q.filter.statuses]));
  if (q.filter.key === "balance") where.push(eq(schema.orders.paymentStatus, "deposit_paid"));
  if (q.from) where.push(gte(schema.orders.fulfillmentDate, q.from));
  if (q.to) where.push(lte(schema.orders.fulfillmentDate, q.to));
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(schema.orders.reference, like), ilike(schema.orders.customerName, like), ilike(schema.orders.customerEmail, like))!);
  }
  const upcoming = q.filter.key === "open" || q.filter.key === "balance";
  return db().query.orders.findMany({
    where: and(...where),
    with: { items: true },
    orderBy: upcoming ? [asc(schema.orders.fulfillmentDate), asc(schema.orders.fulfillmentWindow)] : [desc(schema.orders.createdAt)],
    limit,
  });
}

/** Neutralise spreadsheet formulas and quote every cell (RFC 4180). */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function ordersCsv(orders: Awaited<ReturnType<typeof searchOrders>>): string {
  const head = ["Reference", "Created", "Status", "Payment", "Customer", "Email", "Phone", "Method", "Date", "Window", "Items", "Currency", "Subtotal", "Discount", "Delivery", "Tax", "Total", "Paid", "Refunded", "Balance"];
  const money = (c: number) => (c / 100).toFixed(2);
  const rows = orders.map((o) => [
    o.reference,
    o.createdAt.toISOString(),
    ORDER_STATUS_LABELS[o.status],
    PAYMENT_STATUS_LABELS[o.paymentStatus],
    o.customerName,
    o.customerEmail,
    o.customerPhone,
    o.fulfillmentMethod,
    o.fulfillmentDate,
    o.fulfillmentWindow,
    o.items.map((i) => `${i.quantity} x ${i.productName}${i.options.length ? ` (${i.options.map((x) => `${x.option}: ${x.value}`).join("; ")})` : ""}`).join(" | "),
    o.currency.toUpperCase(),
    money(o.subtotalCents),
    money(o.discountCents),
    money(o.deliveryFeeCents),
    money(o.taxCents),
    money(o.totalCents),
    money(o.amountPaidCents),
    money(o.amountRefundedCents),
    money(Math.max(0, o.totalCents - o.amountPaidCents)),
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
