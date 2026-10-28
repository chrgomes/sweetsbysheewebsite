import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { saveInquiry, sendQuoteAction, withdrawQuoteAction } from "@/app/admin/actions/inquiries";
import { retryNotificationAction } from "@/app/admin/actions/system";
import { AdminForm } from "@/components/admin/admin-form";
import { QuoteEditor, type QuoteEditorValues } from "@/components/admin/quote-editor";
import { AdminHeader, DefinitionList, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Field, Select, Textarea } from "@/components/ui/field";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { dayUsage } from "@/lib/capacity";
import { formatDate, formatDateTime } from "@/lib/dates";
import { INQUIRY_STATUS_LABELS, MANUAL_INQUIRY_STATUSES } from "@/lib/inquiries";
import { quoteLink } from "@/lib/links";
import { centsToInput, formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { QUOTE_STATUS_LABELS, quotesForInquiry } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Custom request" };

const CONTACT = { email: "Email", phone: "Phone call", text: "Text message" } as const;

export default async function InquiryDetail({ params }: PageProps<"/admin/inquiries/[id]">) {
  const admin = await requireAdmin("inquiries:view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [r, settings, quotes] = await Promise.all([
    db().query.inquiries.findFirst({ where: eq(schema.inquiries.id, id), with: { attachments: true, product: true } }),
    getSettings(),
    quotesForInquiry(id),
  ]);
  if (!r) notFound();
  const [order, notifications, usage] = await Promise.all([
    db().query.orders.findFirst({ where: eq(schema.orders.sourceInquiryId, id), columns: { id: true, reference: true, status: true } }),
    db().query.notifications.findMany({ where: and(eq(schema.notifications.relatedType, "inquiry"), eq(schema.notifications.relatedId, id)), orderBy: [desc(schema.notifications.createdAt)], limit: 20 }),
    dayUsage(r.eventDate, settings),
  ]);
  const a = r.deliveryAddress;
  const closed = ["confirmed", "completed", "cancelled"].includes(r.status);
  const draft = quotes.find((q) => q.status === "draft");
  const base = draft ?? quotes[0];
  const initial: QuoteEditorValues = base
    ? {
        fulfillmentMethod: base.fulfillmentMethod,
        fulfillmentDate: base.fulfillmentDate,
        lines: base.lines.map((l) => ({ description: l.description, quantity: l.quantity, price: centsToInput(l.unitPriceCents) })),
        deliveryFee: centsToInput(base.deliveryFeeCents),
        deposit: draft ? centsToInput(base.depositCents) : "",
        capacityUnits: base.capacityUnits,
        customerMessage: base.customerMessage ?? "",
      }
    : {
        fulfillmentMethod: r.fulfillmentMethod,
        fulfillmentDate: r.eventDate,
        lines: [{ description: [r.productType, r.servings ? `for ${r.servings}` : null].filter(Boolean).join(" "), quantity: 1, price: "" }],
        deliveryFee: centsToInput(settings.deliveryFeeCents ?? 0),
        deposit: "",
        capacityUnits: r.product?.capacityUnits ?? 1,
        customerMessage: "",
      };
  const canQuote = can(admin.role, "quotes:manage") && !closed;

  return (
    <>
      <AdminHeader
        title={`Request ${r.reference}`}
        description={`Received ${formatDateTime(r.createdAt)}`}
        actions={
          <>
            <Badge tone="berry">{INQUIRY_STATUS_LABELS[r.status]}</Badge>
            <a href={`mailto:${r.customerEmail}?subject=${encodeURIComponent(`Your request ${r.reference}`)}`} className="rounded-full border border-line-strong px-3 py-1 text-sm hover:border-ink">Email customer</a>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Request">
            <DefinitionList items={[
              ["Event date", `${formatDate(r.eventDate)}${usage.capacity !== null ? ` — ${Math.max(0, usage.remaining ?? 0)} of ${usage.capacity} capacity units free` : ""}`],
              ["Occasion", r.eventType],
              ["Requested", r.product ? <Link key="p" className="text-berry hover:underline" href={`/admin/products/${r.product.id}`}>{r.productType}</Link> : r.productType],
              ["Servings", r.servings?.toString()],
              ["Tiers", r.tiers?.toString()],
              ["Size", r.size],
              ["Flavours", r.flavours],
              ["Design", r.design],
              ["Theme", r.theme],
              ["Colours", r.colours],
              ["Inscription", r.message],
              ["Allergies", r.allergies],
              ["Budget", r.budget],
              ["Other details", r.details],
            ]} />
          </Panel>
          {r.attachments.length > 0 && (
            <Panel title="Inspiration photos">
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {r.attachments.map((att) => (
                  <li key={att.id}>
                    <a href={`/admin/attachments/${att.id}`} target="_blank" rel="noopener" className="block">
                      {att.mimeType === "image/heic" ? (
                        <span className="grid aspect-square place-items-center rounded-xl bg-blush text-sm">HEIC photo — open</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- private, authenticated file; not suitable for the public image optimiser
                        <img src={`/admin/attachments/${att.id}`} alt={`Inspiration photo: ${att.originalName}`} className="aspect-square w-full rounded-xl object-cover" />
                      )}
                      <span className="mt-1 block truncate text-xs text-ink-muted">{att.originalName}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Quotes">
            {order && <p className="mb-4 text-sm">Accepted — <Link href={`/admin/orders/${order.id}`} className="text-berry hover:underline">order {order.reference}</Link>.</p>}
            {quotes.length === 0 && <p className="mb-4 text-sm text-ink-soft">No quote yet.</p>}
            <ul className="space-y-4">
              {quotes.map((q) => (
                <li key={q.id} className="rounded-xl border border-line p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">Version {q.version} · {q.reference}</span>
                    <Badge tone={q.status === "accepted" ? "sage" : q.status === "sent" ? "honey" : q.status === "draft" ? "berry" : "neutral"}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
                  </div>
                  <ul className="mt-3 space-y-1">
                    {q.lines.map((l) => (
                      <li key={l.id} className="flex justify-between gap-3"><span>{l.quantity} × {l.description}</span><span className="tabular-nums">{formatMoney(l.lineTotalCents, q.currency)}</span></li>
                    ))}
                  </ul>
                  <p className="mt-2 text-ink-soft">
                    {q.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"} {formatDate(q.fulfillmentDate)} · Total {formatMoney(q.totalCents, q.currency)}
                    {q.depositCents > 0 && q.depositCents < q.totalCents ? ` · Deposit ${formatMoney(q.depositCents, q.currency)}` : ""} · {q.capacityUnits} unit{q.capacityUnits === 1 ? "" : "s"}
                  </p>
                  {q.sentAt && <p className="text-xs text-ink-muted">Sent {formatDateTime(q.sentAt)}{q.expiresAt ? ` · expires ${formatDateTime(q.expiresAt)}` : ""}</p>}
                  {q.declineReason && <p className="mt-1 text-xs text-ink-muted">Customer said: {q.declineReason}</p>}
                  {q.status === "sent" && can(admin.role, "quotes:manage") && (
                    <p className="mt-2 text-xs"><span className="text-ink-muted">Customer link: </span><span className="break-all">{quoteLink(q)}</span></p>
                  )}
                  {canQuote && q.status === "draft" && (
                    <AdminForm action={sendQuoteAction} submitLabel="Send to customer" className="mt-4 space-y-3">
                      <input type="hidden" name="inquiryId" value={r.id} />
                      <input type="hidden" name="quoteId" value={q.id} />
                      <p className="text-xs text-ink-muted">Emails {r.customerEmail} a link to review and accept. Sending a new version withdraws any earlier one. The date isn&apos;t held until they accept.</p>
                      <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="force" className="size-4" /> Send anyway if the date is at capacity</label>
                    </AdminForm>
                  )}
                  {canQuote && (q.status === "sent" || q.status === "draft") && (
                    <AdminForm action={withdrawQuoteAction} submitLabel={q.status === "draft" ? "Discard draft" : "Withdraw quote"} variant="secondary" className="mt-3">
                      <input type="hidden" name="inquiryId" value={r.id} />
                      <input type="hidden" name="quoteId" value={q.id} />
                    </AdminForm>
                  )}
                </li>
              ))}
            </ul>
            {canQuote && (
              <div className="mt-6 border-t border-line pt-6">
                <h3 className="mb-4 text-base font-medium text-ink">{draft ? `Edit draft (version ${draft.version})` : quotes.length ? "Prepare a revised quote" : "Prepare a quote"}</h3>
                <QuoteEditor inquiryId={r.id} initial={initial} taxRateBps={settings.taxRateBps} defaultDepositBps={settings.depositPercentBps} currency={settings.currency} />
              </div>
            )}
          </Panel>

          <Panel title="Customer">
            <DefinitionList items={[
              ["Name", r.customerId ? <Link key="c" href={`/admin/customers/${r.customerId}`} className="text-berry hover:underline">{r.customerName}</Link> : r.customerName],
              ["Email", r.customerEmail],
              ["Phone", r.customerPhone],
              ["Prefers", CONTACT[r.preferredContact as keyof typeof CONTACT] ?? r.preferredContact],
              ["Fulfilment", r.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"],
              ["Address", a ? [a.line1, a.line2, `${a.city}, ${a.region} ${a.postalCode}`].filter(Boolean).join("\n") : null],
            ]} />
          </Panel>

          <Panel title="Emails">
            {notifications.length === 0 ? (
              <p className="text-sm text-ink-soft">No emails yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {notifications.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span>{n.subject}<span className="block text-xs text-ink-muted">To {n.toEmail} · {formatDateTime(n.sentAt ?? n.createdAt)}{n.lastError ? ` · ${n.lastError}` : ""}</span></span>
                    <span className="flex items-center gap-2">
                      <Badge tone={n.status === "sent" ? "sage" : n.status === "failed" ? "danger" : "honey"}>{n.status}</Badge>
                      {n.status === "failed" && can(admin.role, "orders:manage") && (
                        <AdminForm action={retryNotificationAction} submitLabel="Retry" variant="secondary" className="flex items-center gap-2">
                          <input type="hidden" name="notificationId" value={n.id} />
                          <input type="hidden" name="back" value={`/admin/inquiries/${r.id}`} />
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
          {can(admin.role, "inquiries:manage") ? (
            <Panel title="Review">
              <AdminForm action={saveInquiry}>
                <input type="hidden" name="inquiryId" value={r.id} />
                <Field id="status" label="Status" required hint="Quote statuses are set automatically when you send a quote and the customer responds.">
                  <Select id="status" name="status" defaultValue={r.status} hasHint>
                    {!MANUAL_INQUIRY_STATUSES.includes(r.status) && <option value={r.status}>{INQUIRY_STATUS_LABELS[r.status]}</option>}
                    {MANUAL_INQUIRY_STATUSES.map((s) => <option key={s} value={s}>{INQUIRY_STATUS_LABELS[s]}</option>)}
                  </Select>
                </Field>
                <Field id="internalNotes" label="Internal notes">
                  <Textarea id="internalNotes" name="internalNotes" rows={4} defaultValue={r.internalNotes ?? ""} />
                </Field>
              </AdminForm>
            </Panel>
          ) : (
            r.internalNotes && <Panel title="Internal notes"><p className="text-sm whitespace-pre-line">{r.internalNotes}</p></Panel>
          )}
        </div>
      </div>
    </>
  );
}
