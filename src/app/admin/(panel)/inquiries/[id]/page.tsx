import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { convertInquiry, saveInquiry } from "@/app/admin/actions/inquiries";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminHeader, DefinitionList, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { INQUIRY_STATUS_LABELS, INQUIRY_STATUSES } from "@/lib/inquiries";
import { centsToInput, formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Custom request" };

export default async function InquiryDetail({ params }: PageProps<"/admin/inquiries/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [r, settings] = await Promise.all([db().query.inquiries.findFirst({ where: eq(schema.inquiries.id, id), with: { attachments: true, product: true } }), getSettings()]);
  if (!r) notFound();
  const a = r.deliveryAddress;
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
              ["Event date", formatDate(r.eventDate)],
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
          <Panel title="Customer">
            <DefinitionList items={[
              ["Name", r.customerName],
              ["Email", r.customerEmail],
              ["Phone", r.customerPhone],
              ["Fulfilment", r.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"],
              ["Address", a ? [a.line1, a.line2, `${a.city}, ${a.region} ${a.postalCode}`].filter(Boolean).join("\n") : null],
              ["Notification email", r.businessEmailStatus],
              ["Customer acknowledgement", r.customerEmailStatus],
            ]} />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Review & quote">
            <AdminForm action={saveInquiry}>
              <input type="hidden" name="inquiryId" value={r.id} />
              <Field id="status" label="Status" required>
                <Select id="status" name="status" defaultValue={r.status}>
                  {INQUIRY_STATUSES.map((s) => <option key={s} value={s}>{INQUIRY_STATUS_LABELS[s]}</option>)}
                </Select>
              </Field>
              <Field id="quotedPrice" label="Agreed / quoted price (before tax)">
                <Input id="quotedPrice" name="quotedPrice" inputMode="decimal" placeholder="0.00" defaultValue={centsToInput(r.quotedPriceCents)} />
              </Field>
              <Field id="quoteNotes" label="Quote details (shared with customer)">
                <Textarea id="quoteNotes" name="quoteNotes" rows={3} defaultValue={r.quoteNotes ?? ""} />
              </Field>
              <Field id="internalNotes" label="Internal notes">
                <Textarea id="internalNotes" name="internalNotes" rows={3} defaultValue={r.internalNotes ?? ""} />
              </Field>
            </AdminForm>
          </Panel>
          <Panel title="Convert to order">
            {r.convertedOrderId ? (
              <p className="text-sm">Converted. <Link href={`/admin/orders/${r.convertedOrderId}`} className="text-berry hover:underline">View order →</Link></p>
            ) : (
              <AdminForm action={convertInquiry} submitLabel="Create order" variant="secondary">
                <input type="hidden" name="inquiryId" value={r.id} />
                <p className="text-sm text-ink-soft">
                  Creates an order at the agreed price{r.quotedPriceCents !== null ? ` (${formatMoney(r.quotedPriceCents, settings.currency)})` : ""}, adds tax{r.fulfillmentMethod === "delivery" ? " and the delivery fee" : ""} per your settings, and marks this request accepted. Save the price above first.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="sendEmail" defaultChecked className="size-4 accent-[var(--berry)]" /> Email the quote{settings.checkoutEnabled ? " and payment link" : ""} to the customer
                </label>
              </AdminForm>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
