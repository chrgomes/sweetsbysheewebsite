import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { changeOrderStatus, saveOrderNotes } from "@/app/admin/actions/orders";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminHeader, DefinitionList, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Select, Textarea } from "@/components/ui/field";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { allowedNextStatuses, ORDER_STATUS_LABELS } from "@/lib/orders";

export const metadata = { title: "Order" };

export default async function OrderDetail({ params }: PageProps<"/admin/orders/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const order = await db().query.orders.findFirst({ where: eq(schema.orders.id, id), with: { items: true } });
  if (!order) notFound();
  const next = allowedNextStatuses(order.status);
  const a = order.deliveryAddress;
  const cur = order.currency;
  return (
    <>
      <AdminHeader title={`Order ${order.reference}`} description={`Placed ${formatDateTime(order.createdAt)}`} actions={<Badge tone="berry">{ORDER_STATUS_LABELS[order.status]}</Badge>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Items">
            <ul className="divide-y divide-line text-sm">
              {order.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-4 py-3">
                  <span>{i.quantity} × {i.productName}{i.options.length > 0 && <span className="block text-ink-muted">{i.options.map((o) => `${o.option}: ${o.value}`).join(" · ")}</span>}</span>
                  <span className="tabular-nums">{formatMoney(i.lineTotalCents, cur)}</span>
                </li>
              ))}
            </ul>
            <DefinitionList items={[
              ["Subtotal", formatMoney(order.subtotalCents, cur)],
              ["Delivery", order.deliveryFeeCents ? formatMoney(order.deliveryFeeCents, cur) : null],
              ["Tax", `${formatMoney(order.taxCents, cur)} (${(order.taxRateBps / 100).toFixed(2)}%)`],
              ["Total", formatMoney(order.totalCents, cur)],
              ["Paid at", order.paidAt ? formatDateTime(order.paidAt) : "Not paid"],
              ["Payment", order.paymentProvider ? `${order.paymentProvider}${order.paymentIntentId ? ` · ${order.paymentIntentId}` : ""}` : "—"],
            ]} />
          </Panel>
          <Panel title="Customer & fulfilment">
            <DefinitionList items={[
              ["Name", order.customerName],
              ["Email", <a key="e" href={`mailto:${order.customerEmail}`} className="text-berry hover:underline">{order.customerEmail}</a>],
              ["Phone", order.customerPhone],
              ["Method", order.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"],
              ["Date", formatDate(order.fulfillmentDate)],
              ["Address", a ? [a.line1, a.line2, `${a.city}, ${a.region} ${a.postalCode}`].filter(Boolean).join("\n") : null],
              ["Customer notes", order.notes],
              ["From request", order.sourceInquiryId ? <Link key="i" className="text-berry hover:underline" href={`/admin/inquiries/${order.sourceInquiryId}`}>View custom request</Link> : null],
            ]} />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Status">
            {next.length ? (
              <AdminForm action={changeOrderStatus} submitLabel="Update status">
                <input type="hidden" name="orderId" value={order.id} />
                <label htmlFor="status" className="text-sm text-ink-soft">Move to</label>
                <Select id="status" name="status" defaultValue={next[0]}>
                  {next.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s as keyof typeof ORDER_STATUS_LABELS]}</option>)}
                </Select>
                {order.status === "pending_payment" && <p className="text-xs text-ink-muted">Orders become “Paid” automatically when the payment provider confirms payment.</p>}
              </AdminForm>
            ) : (
              <p className="text-sm text-ink-soft">No further status changes are available.</p>
            )}
            {(order.status === "paid" || order.status === "in_progress" || order.status === "ready" || order.status === "completed") && (
              <p className="mt-4 text-xs text-ink-muted">Marking an order refunded does not issue a refund — process refunds in your payment provider&apos;s dashboard first.</p>
            )}
          </Panel>
          <Panel title="Internal notes">
            <AdminForm action={saveOrderNotes} submitLabel="Save notes">
              <input type="hidden" name="orderId" value={order.id} />
              <label htmlFor="internalNotes" className="sr-only">Internal notes</label>
              <Textarea id="internalNotes" name="internalNotes" defaultValue={order.internalNotes ?? ""} rows={5} />
            </AdminForm>
          </Panel>
        </div>
      </div>
    </>
  );
}
