import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { changeOrderStatus, saveOrderNotes } from "@/app/admin/actions/orders";
import { retryNotificationAction } from "@/app/admin/actions/system";
import { AdminForm } from "@/components/admin/admin-form";
import { OfflinePaymentForm, RefundForm } from "@/components/admin/forms";
import { AdminHeader, DefinitionList, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Field, Select, Textarea } from "@/components/ui/field";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { stockForOrder } from "@/lib/inventory";
import { orderLink } from "@/lib/links";
import { centsToInput, formatMoney } from "@/lib/money";
import { allowedNextStatuses, amountDue, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, statusLabel, transitionPermission } from "@/lib/orders";
import { can } from "@/lib/permissions";
import { formatQuantity } from "@/lib/recipe-math";

export const metadata = { title: "Order" };

const KIND_LABELS = { full: "Payment", deposit: "Deposit", balance: "Balance", offline: "Recorded payment" } as const;

export default async function OrderDetail({ params }: PageProps<"/admin/orders/[id]">) {
  const admin = await requireAdmin("orders:view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const order = await db().query.orders.findFirst({
    where: eq(schema.orders.id, id),
    with: { items: true, payments: { orderBy: (p, o) => [o.asc(p.createdAt)], with: { refunds: true } }, reservation: true },
  });
  if (!order) notFound();
  const [notifications, history, stock] = await Promise.all([
    db().query.notifications.findMany({ where: and(eq(schema.notifications.relatedType, "order"), eq(schema.notifications.relatedId, id)), orderBy: [desc(schema.notifications.createdAt)], limit: 30 }),
    db().query.auditLog.findMany({ where: and(eq(schema.auditLog.entityType, "order"), eq(schema.auditLog.entityId, id)), orderBy: [desc(schema.auditLog.createdAt)], limit: 30 }),
    can(admin.role, "inventory:view") ? stockForOrder(id) : Promise.resolve([]),
  ]);
  const role = admin.role;
  const next = allowedNextStatuses(order).filter((s) => can(role, transitionPermission(order.status, s)));
  const a = order.deliveryAddress;
  const cur = order.currency;
  const balance = amountDue(order, "full");
  const refunds = order.payments.flatMap((p) => p.refunds);

  return (
    <>
      <AdminHeader
        title={`Order ${order.reference}`}
        description={`Placed ${formatDateTime(order.createdAt)}`}
        actions={
          <>
            <Badge tone={order.status === "cancelled" ? "neutral" : order.status === "on_hold" ? "danger" : "berry"}>{statusLabel(order)}</Badge>
            <Badge tone={order.paymentStatus === "paid" ? "sage" : order.paymentStatus === "failed" ? "danger" : "honey"}>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</Badge>
          </>
        }
      />
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
            <div className="mt-4">
              <DefinitionList items={[
                ["Subtotal", formatMoney(order.subtotalCents, cur)],
                ["Discount", order.discountCents ? `−${formatMoney(order.discountCents, cur)}${order.discountCode ? ` (${order.discountCode})` : ""}` : null],
                ["Delivery", order.deliveryFeeCents ? formatMoney(order.deliveryFeeCents, cur) : null],
                ["Tax", `${formatMoney(order.taxCents, cur)} (${(order.taxRateBps / 100).toFixed(2)}%)`],
                ["Total", <strong key="t">{formatMoney(order.totalCents, cur)}</strong>],
                ["Deposit required", order.depositCents ? formatMoney(order.depositCents, cur) : null],
                ["Paid", formatMoney(order.amountPaidCents, cur)],
                ["Refunded", order.amountRefundedCents ? formatMoney(order.amountRefundedCents, cur) : null],
                ["Balance due", balance > 0 && order.status !== "cancelled" ? formatMoney(balance, cur) : null],
              ]} />
            </div>
          </Panel>

          <Panel title="Payments">
            {order.payments.length === 0 ? (
              <p className="text-sm text-ink-soft">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {order.payments.map((p) => {
                  const inFlight = p.refunds.filter((r) => r.status === "pending").reduce((n, r) => n + r.amountCents, 0);
                  const refundable = p.status === "succeeded" ? p.amountCents - p.refundedCents - inFlight : 0;
                  return (
                    <li key={p.id} className="py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span>
                          <strong>{KIND_LABELS[p.kind]}</strong> · {formatMoney(p.amountCents, p.currency)}
                          <span className="block text-ink-muted">
                            {p.provider === "offline" ? `${p.method ?? "Offline"} — ${p.note ?? ""}` : `${p.provider}${p.providerPaymentId ? ` · ${p.providerPaymentId}` : ""}`}
                          </span>
                          <span className="block text-xs text-ink-muted">{p.succeededAt ? `Received ${formatDateTime(p.succeededAt)}` : `Created ${formatDateTime(p.createdAt)}`}{p.refundedCents ? ` · ${formatMoney(p.refundedCents, p.currency)} refunded` : ""}</span>
                        </span>
                        <Badge tone={p.status === "succeeded" ? "sage" : p.status === "pending" ? "honey" : "neutral"}>{p.status}</Badge>
                      </div>
                      {refundable > 0 && can(role, "orders:refund") && (
                        <details className="mt-3 rounded-xl border border-line p-4">
                          <summary className="cursor-pointer text-sm font-medium text-berry">Refund this payment…</summary>
                          <RefundForm orderId={order.id} paymentId={p.id} provider={p.provider} refundableLabel={formatMoney(refundable, p.currency)} refundableInput={centsToInput(refundable)} />
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {refunds.length > 0 && (
              <>
                <h3 className="mt-6 mb-2 text-sm font-semibold text-ink">Refunds</h3>
                <ul className="divide-y divide-line text-sm">
                  {refunds.map((r) => (
                    <li key={r.id} className="flex flex-wrap justify-between gap-3 py-2">
                      <span>{formatMoney(r.amountCents, cur)} — {r.reason}<span className="block text-xs text-ink-muted">{formatDateTime(r.createdAt)}{r.failureReason ? ` · ${r.failureReason}` : ""}</span></span>
                      <Badge tone={r.status === "succeeded" ? "sage" : r.status === "pending" ? "honey" : "danger"}>{r.status}</Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {balance > 0 && order.status !== "cancelled" && can(role, "orders:payments") && (
              <details className="mt-6 rounded-xl border border-line p-4">
                <summary className="cursor-pointer text-sm font-medium text-berry">Record a payment received outside the website…</summary>
                <OfflinePaymentForm orderId={order.id} balanceLabel={formatMoney(balance, cur)} balanceInput={centsToInput(balance)} />
              </details>
            )}
          </Panel>

          <Panel title="Customer & fulfilment">
            <DefinitionList items={[
              ["Name", order.customerId ? <Link key="c" href={`/admin/customers/${order.customerId}`} className="text-berry hover:underline">{order.customerName}</Link> : order.customerName],
              ["Email", <a key="e" href={`mailto:${order.customerEmail}`} className="text-berry hover:underline">{order.customerEmail}</a>],
              ["Phone", order.customerPhone],
              ["Method", order.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"],
              ["Date", formatDate(order.fulfillmentDate)],
              ["Window", order.fulfillmentWindow],
              ["Address", a ? [a.line1, a.line2, `${a.city}, ${a.region} ${a.postalCode}`].filter(Boolean).join("\n") : null],
              ["Customer notes", order.notes],
              ["Capacity", order.reservation ? `${order.reservation.units} unit${order.reservation.units === 1 ? "" : "s"} · ${order.reservation.status}` : null],
              ["Cancelled", order.cancelledAt ? `${formatDateTime(order.cancelledAt)} — ${order.cancelReason ?? ""}` : null],
              ["From request", order.sourceInquiryId ? <Link key="i" className="text-berry hover:underline" href={`/admin/inquiries/${order.sourceInquiryId}`}>View custom request</Link> : null],
            ]} />
          </Panel>

          {can(role, "inventory:view") && (
            <Panel title="Ingredients">
              {stock.length > 0 ? (
                <ul className="divide-y divide-line text-sm">
                  {stock.map((m) => (
                    <li key={m.id} className="flex justify-between gap-3 py-2">
                      <Link href={`/admin/inventory/${m.ingredient.id}`} className="hover:text-berry">{m.ingredient.name}</Link>
                      <span className="tabular-nums">{m.kind === "reversal" ? "Returned +" : "Used "}{formatQuantity(Math.abs(m.quantity), m.ingredient.unit)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-soft">
                  {order.sourceQuoteId
                    ? "Custom-quote orders don't use stock automatically; record what was used under Inventory (waste or stocktake)."
                    : "Stock is taken from inventory when this order moves to In production, for products that have a recipe."}
                </p>
              )}
            </Panel>
          )}

          <Panel title="Emails">
            {notifications.length === 0 ? (
              <p className="text-sm text-ink-soft">No emails for this order.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {notifications.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span>{n.subject}<span className="block text-xs text-ink-muted">To {n.toEmail} · {formatDateTime(n.sentAt ?? n.createdAt)}{n.lastError ? ` · ${n.lastError}` : ""}</span></span>
                    <span className="flex items-center gap-2">
                      <Badge tone={n.status === "sent" ? "sage" : n.status === "failed" ? "danger" : "honey"}>{n.status}</Badge>
                      {n.status === "failed" && can(role, "orders:manage") && (
                        <AdminForm action={retryNotificationAction} submitLabel="Retry" variant="secondary" className="flex items-center gap-2">
                          <input type="hidden" name="notificationId" value={n.id} />
                          <input type="hidden" name="back" value={`/admin/orders/${order.id}`} />
                        </AdminForm>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Status">
            {next.length ? (
              <AdminForm action={changeOrderStatus} submitLabel="Update status">
                <input type="hidden" name="orderId" value={order.id} />
                <Field id="status" label="Move to" required>
                  <Select id="status" name="status" defaultValue={next[0]}>
                    {next.map((s) => <option key={s} value={s}>{order.status === "on_hold" && s === order.onHoldFrom ? `Resume (${ORDER_STATUS_LABELS[s]})` : ORDER_STATUS_LABELS[s]}</option>)}
                  </Select>
                </Field>
                <Field id="reason" label="Reason" hint="Required to cancel or hold. Included in the cancellation email.">
                  <Textarea id="reason" name="reason" rows={2} maxLength={500} hasHint />
                </Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notify" defaultChecked className="size-4" /> Email the customer about this change</label>
              </AdminForm>
            ) : (
              <p className="text-sm text-ink-soft">{order.status === "pending" ? "This order confirms automatically once a payment is received." : "No further status changes are available to you."}</p>
            )}
            {order.status === "pending" && <p className="mt-4 text-xs text-ink-muted">Orders are confirmed only by a verified payment, or by recording a payment you received.</p>}
          </Panel>

          {can(role, "orders:manage") && order.status !== "cancelled" && (
            <Panel title="Customer link">
              <p className="text-sm text-ink-soft">The customer&apos;s private order page{balance > 0 ? ", where they can pay what's due" : ""}. Share it only with the customer.</p>
              <label htmlFor="customer-link" className="sr-only">Customer order link</label>
              <input id="customer-link" readOnly value={orderLink(order)} className="mt-3 w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-xs" />
            </Panel>
          )}

          {can(role, "orders:manage") && (
            <Panel title="Internal notes">
              <AdminForm action={saveOrderNotes} submitLabel="Save notes">
                <input type="hidden" name="orderId" value={order.id} />
                <label htmlFor="internalNotes" className="sr-only">Internal notes</label>
                <Textarea id="internalNotes" name="internalNotes" defaultValue={order.internalNotes ?? ""} rows={5} />
              </AdminForm>
            </Panel>
          )}
          {!can(role, "orders:manage") && order.internalNotes && <Panel title="Internal notes"><p className="text-sm whitespace-pre-line">{order.internalNotes}</p></Panel>}

          <Panel title="History">
            <ol className="space-y-3 text-sm">
              {history.map((h) => (
                <li key={h.id}>
                  <span className="font-medium">{h.action.replace(/[._]/g, " ")}</span>
                  <span className="block text-xs text-ink-muted">{formatDateTime(h.createdAt)} · {h.actorLabel}{typeof h.details?.reason === "string" ? ` · ${h.details.reason}` : ""}</span>
                </li>
              ))}
              {history.length === 0 && <li className="text-ink-muted">No changes yet.</li>}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
