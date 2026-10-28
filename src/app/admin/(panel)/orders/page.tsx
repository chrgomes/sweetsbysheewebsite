import Link from "next/link";
import { AdminHeader, RowLink, Table } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { ORDER_FILTERS, orderQueryString, parseOrderQuery, searchOrders } from "@/lib/admin/order-search";
import { requireAdmin } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/orders";

export const metadata = { title: "Orders" };

const STATUS_TONE = { pending: "honey", confirmed: "berry", in_production: "berry", ready: "sage", completed: "sage", cancelled: "neutral", on_hold: "danger" } as const;

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const admin = await requireAdmin("orders:view");
  const query = parseOrderQuery(await searchParams);
  const orders = await searchOrders(query);
  const inputCls = "rounded-full border border-line-strong bg-white px-4 py-1.5 text-sm";
  return (
    <>
      <AdminHeader
        title="Orders"
        description="Online orders and accepted custom quotes."
        actions={can(admin.role, "orders:export") ? <a href={`/admin/orders-export?${orderQueryString(query)}`} className="rounded-full border border-line-strong px-4 py-2 text-sm hover:border-ink">Export CSV</a> : undefined}
      />
      <nav aria-label="Order filters" className="mb-4 flex flex-wrap gap-2">
        {ORDER_FILTERS.map((f) => (
          <Link key={f.key} href={`/admin/orders?${orderQueryString(query, { status: f.key })}`} aria-current={f.key === query.filter.key ? "page" : undefined} className="rounded-full border border-line-strong px-3 py-1.5 text-sm aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-cream">
            {f.label}
          </Link>
        ))}
      </nav>
      <form className="mb-6 flex flex-wrap items-end gap-3" role="search">
        <input type="hidden" name="status" value={query.filter.key} />
        <label className="flex flex-col gap-1 text-xs text-ink-muted">Search<input name="q" defaultValue={query.q} placeholder="Reference, name or email" className={inputCls} /></label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">Fulfilment from<input type="date" name="from" defaultValue={query.from} className={inputCls} /></label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">to<input type="date" name="to" defaultValue={query.to} className={inputCls} /></label>
        <button className="rounded-full bg-ink px-4 py-1.5 text-sm text-cream">Apply</button>
      </form>
      <Table head={["Reference", "Customer", "Fulfilment", "Total", "Status", "Payment"]} empty={orders.length ? undefined : "No orders match."}>
        {orders.map((o) => (
          <tr key={o.id}>
            <td className="px-4 py-3"><RowLink href={`/admin/orders/${o.id}`}>{o.reference}</RowLink>{o.sourceQuoteId && <span className="block text-xs text-ink-muted">Custom quote</span>}</td>
            <td className="px-4 py-3">{o.customerName}<span className="block text-ink-muted">{o.customerEmail}</span></td>
            <td className="px-4 py-3">{o.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"}<span className="block text-ink-muted">{formatDate(o.fulfillmentDate)}{o.fulfillmentWindow ? ` · ${o.fulfillmentWindow}` : ""}</span></td>
            <td className="px-4 py-3 tabular-nums">{formatMoney(o.totalCents, o.currency)}{o.paymentStatus === "deposit_paid" && <span className="block text-xs text-ink-muted">{formatMoney(o.totalCents - o.amountPaidCents, o.currency)} due</span>}</td>
            <td className="px-4 py-3"><Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge></td>
            <td className="px-4 py-3"><Badge tone={o.paymentStatus === "paid" ? "sage" : o.paymentStatus === "failed" ? "danger" : "neutral"}>{PAYMENT_STATUS_LABELS[o.paymentStatus]}</Badge></td>
          </tr>
        ))}
      </Table>
    </>
  );
}
