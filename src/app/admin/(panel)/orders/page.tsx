import { and, desc, ilike, inArray, or, type SQL } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { AdminHeader, RowLink, Table } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS_LABELS } from "@/lib/orders";

export const metadata = { title: "Orders" };

const FILTERS = [
  { key: "open", label: "To fulfil", statuses: ["paid", "in_progress", "ready"] },
  { key: "pending_payment", label: "Awaiting payment", statuses: ["pending_payment"] },
  { key: "completed", label: "Completed", statuses: ["completed"] },
  { key: "closed", label: "Cancelled / failed", statuses: ["cancelled", "payment_failed", "refunded"] },
  { key: "all", label: "All", statuses: [] },
] as const;

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireAdmin();
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.status) ?? FILTERS[0];
  const search = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const where: SQL[] = [];
  if (filter.statuses.length) where.push(inArray(schema.orders.status, [...filter.statuses]));
  if (search) where.push(or(ilike(schema.orders.reference, `%${search}%`), ilike(schema.orders.customerName, `%${search}%`), ilike(schema.orders.customerEmail, `%${search}%`))!);
  const orders = await db().query.orders.findMany({ where: and(...where), orderBy: [filter.key === "open" ? schema.orders.fulfillmentDate : desc(schema.orders.createdAt)], limit: 200 });
  return (
    <>
      <AdminHeader title="Orders" description="Orders placed through online checkout and converted custom requests." />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Order filters" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link key={f.key} href={`/admin/orders?status=${f.key}`} aria-current={f.key === filter.key ? "page" : undefined} className="rounded-full border border-line-strong px-3 py-1.5 text-sm aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-cream">
              {f.label}
            </Link>
          ))}
        </nav>
        <form className="flex gap-2" role="search">
          <input type="hidden" name="status" value={filter.key} />
          <label htmlFor="q" className="sr-only">Search orders</label>
          <input id="q" name="q" defaultValue={search} placeholder="Reference, name or email" className="rounded-full border border-line-strong bg-white px-4 py-1.5 text-sm" />
        </form>
      </div>
      <Table head={["Reference", "Customer", "Fulfilment", "Total", "Status"]} empty={orders.length ? undefined : "No orders here yet."}>
        {orders.map((o) => (
          <tr key={o.id}>
            <td className="px-4 py-3"><RowLink href={`/admin/orders/${o.id}`}>{o.reference}</RowLink></td>
            <td className="px-4 py-3">{o.customerName}<span className="block text-ink-muted">{o.customerEmail}</span></td>
            <td className="px-4 py-3">{o.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"}<span className="block text-ink-muted">{formatDate(o.fulfillmentDate)}</span></td>
            <td className="px-4 py-3 tabular-nums">{formatMoney(o.totalCents, o.currency)}</td>
            <td className="px-4 py-3"><Badge tone={o.status === "paid" ? "berry" : o.status === "pending_payment" ? "honey" : o.status === "completed" ? "sage" : "neutral"}>{ORDER_STATUS_LABELS[o.status]}</Badge></td>
          </tr>
        ))}
      </Table>
    </>
  );
}
