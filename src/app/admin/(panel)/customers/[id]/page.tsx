import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { eraseCustomerAction, saveCustomerNotes } from "@/app/admin/actions/customers";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminHeader, DefinitionList, Panel, RowLink } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/field";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { INQUIRY_STATUS_LABELS } from "@/lib/inquiries";
import { formatMoney } from "@/lib/money";
import { PAYMENT_STATUS_LABELS, statusLabel } from "@/lib/orders";
import { can } from "@/lib/permissions";

export const metadata = { title: "Customer" };

export default async function CustomerDetail({ params }: PageProps<"/admin/customers/[id]">) {
  const admin = await requireAdmin("customers:view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await db().query.customers.findFirst({
    where: eq(schema.customers.id, id),
    with: { orders: { orderBy: (o) => [desc(o.createdAt)] }, inquiries: { orderBy: (i) => [desc(i.createdAt)] } },
  });
  if (!c) notFound();
  const net = c.orders.reduce((n, o) => n + o.amountPaidCents - o.amountRefundedCents, 0);
  const cur = c.orders[0]?.currency ?? "usd";
  return (
    <>
      <AdminHeader title={c.name} description={c.erasedAt ? `Personal data erased ${formatDateTime(c.erasedAt)}` : c.email} actions={c.erasedAt ? <Badge tone="neutral">Erased</Badge> : undefined} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Orders">
            {c.orders.length === 0 ? <p className="text-sm text-ink-soft">No orders.</p> : (
              <ul className="divide-y divide-line text-sm">
                {c.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap justify-between gap-3 py-2">
                    <span><RowLink href={`/admin/orders/${o.id}`}>{o.reference}</RowLink><span className="block text-xs text-ink-muted">{formatDate(o.fulfillmentDate)} · {statusLabel(o)} · {PAYMENT_STATUS_LABELS[o.paymentStatus]}</span></span>
                    <span className="tabular-nums">{formatMoney(o.totalCents, o.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Custom requests">
            {c.inquiries.length === 0 ? <p className="text-sm text-ink-soft">No requests.</p> : (
              <ul className="divide-y divide-line text-sm">
                {c.inquiries.map((i) => (
                  <li key={i.id} className="flex flex-wrap justify-between gap-3 py-2">
                    <span><RowLink href={`/admin/inquiries/${i.id}`}>{i.reference}</RowLink><span className="block text-xs text-ink-muted">{i.eventType} · {formatDate(i.eventDate)}</span></span>
                    <Badge tone="neutral">{INQUIRY_STATUS_LABELS[i.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Details">
            <DefinitionList items={[
              ["Email", c.erasedAt ? "—" : c.email],
              ["Phone", c.phone],
              ["First seen", formatDateTime(c.createdAt)],
              ["Net paid", formatMoney(net, cur)],
            ]} />
          </Panel>
          {!c.erasedAt && can(admin.role, "orders:manage") && (
            <Panel title="Internal notes">
              <AdminForm action={saveCustomerNotes} submitLabel="Save notes">
                <input type="hidden" name="customerId" value={c.id} />
                <label htmlFor="internalNotes" className="sr-only">Internal notes</label>
                <Textarea id="internalNotes" name="internalNotes" rows={4} defaultValue={c.internalNotes ?? ""} />
              </AdminForm>
            </Panel>
          )}
          {!c.erasedAt && can(admin.role, "customers:erase") && (
            <Panel title="Erase personal data">
              <AdminForm action={eraseCustomerAction} submitLabel="Erase permanently" variant="danger">
                <input type="hidden" name="customerId" value={c.id} />
                <p className="text-sm text-ink-soft">For a deletion request. Removes name, contact details, addresses, notes and inspiration photos from this customer&apos;s orders, requests and emails. Amounts stay for accounting. This can&apos;t be undone, and isn&apos;t allowed while an order is still open.</p>
                <label htmlFor="confirmEmail" className="block text-sm">Type <strong>{c.email}</strong> to confirm</label>
                <Input id="confirmEmail" name="confirmEmail" autoComplete="off" />
              </AdminForm>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
