import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { AdminHeader, RowLink, Table } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { INQUIRY_STATUS_LABELS, INQUIRY_STATUSES, type InquiryStatus } from "@/lib/inquiries";

export const metadata = { title: "Custom requests" };

export default async function InquiriesPage({ searchParams }: PageProps<"/admin/inquiries">) {
  await requireAdmin("inquiries:view");
  const sp = await searchParams;
  const status = INQUIRY_STATUSES.includes(sp.status as InquiryStatus) ? (sp.status as InquiryStatus) : undefined;
  const rows = await db().query.inquiries.findMany({
    where: status ? eq(schema.inquiries.status, status) : undefined,
    orderBy: [desc(schema.inquiries.createdAt)],
    with: { attachments: { columns: { id: true } } },
    limit: 200,
  });
  return (
    <>
      <AdminHeader title="Custom requests" description="Requests become orders only when the customer accepts your quote." />
      <nav aria-label="Request filters" className="mb-6 flex flex-wrap gap-2">
        {[undefined, ...INQUIRY_STATUSES].map((s) => (
          <Link key={s ?? "all"} href={s ? `/admin/inquiries?status=${s}` : "/admin/inquiries"} aria-current={s === status ? "page" : undefined} className="rounded-full border border-line-strong px-3 py-1.5 text-sm aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-cream">
            {s ? INQUIRY_STATUS_LABELS[s] : "All"}
          </Link>
        ))}
      </nav>
      <Table head={["Reference", "Customer", "Event", "Requested", "Status", "Received"]} empty={rows.length ? undefined : "No requests yet."}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="px-4 py-3"><RowLink href={`/admin/inquiries/${r.id}`}>{r.reference}</RowLink></td>
            <td className="px-4 py-3">{r.customerName}<span className="block text-ink-muted">{r.customerEmail}</span></td>
            <td className="px-4 py-3">{r.eventType}<span className="block text-ink-muted">{formatDate(r.eventDate)}</span></td>
            <td className="px-4 py-3">{r.productType}{r.servings ? <span className="block text-ink-muted">{r.servings} servings</span> : null}{r.attachments.length > 0 && <span className="block text-ink-muted">{r.attachments.length} photo(s)</span>}</td>
            <td className="px-4 py-3"><Badge tone={r.status === "new" ? "berry" : r.status === "awaiting_customer" || r.status === "deposit_required" ? "honey" : r.status === "confirmed" || r.status === "completed" ? "sage" : "neutral"}>{INQUIRY_STATUS_LABELS[r.status]}</Badge></td>
            <td className="px-4 py-3 text-ink-muted">{formatDateTime(r.createdAt)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
