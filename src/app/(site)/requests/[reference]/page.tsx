import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Container, Eyebrow } from "@/components/ui/container";
import { formatDate } from "@/lib/dates";
import { getInquiryForCustomer, INQUIRY_STATUS_PUBLIC } from "@/lib/inquiries";
import { quoteLink } from "@/lib/links";

export const metadata: Metadata = { title: "Your request", robots: { index: false, follow: false } };

export default async function RequestStatusPage({ params, searchParams }: PageProps<"/requests/[reference]">) {
  const { reference } = await params;
  const { t } = await searchParams;
  const inquiry = await getInquiryForCustomer(reference, typeof t === "string" ? t : undefined);
  if (!inquiry) notFound();
  const openQuote = inquiry.quotes.find((q) => q.status === "sent");
  const rows: [string, string | null | undefined][] = [
    ["Event date", formatDate(inquiry.eventDate)],
    ["Occasion", inquiry.eventType],
    ["Requested", inquiry.productType],
    ["Servings", inquiry.servings?.toString()],
    ["Design", inquiry.design],
    ["Fulfilment", inquiry.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"],
    ["Inspiration photos", inquiry.attachments.length ? `${inquiry.attachments.length} attached` : null],
  ];
  return (
    <Container size="narrow" className="py-12 lg:py-20">
      <Eyebrow>Request {inquiry.reference}</Eyebrow>
      <h1 className="mt-3 text-4xl font-light text-ink sm:text-5xl">Your custom request</h1>
      <div className="mt-6 flex flex-wrap items-center gap-3" role="status">
        <Badge tone="berry">{INQUIRY_STATUS_PUBLIC[inquiry.status]}</Badge>
        <span className="text-sm text-ink-muted">Sent {formatDate(inquiry.createdAt.toISOString().slice(0, 10))}</span>
      </div>
      {openQuote && (
        <p className="mt-6">
          <Link href={quoteLink(openQuote)} className="inline-flex min-h-11 items-center rounded-full bg-berry px-6 font-medium text-white hover:bg-berry-deep">
            Review your quote
          </Link>
        </p>
      )}
      <p className="mt-6 text-ink-soft">This is a request, not a confirmed order. Your date is only booked once you&apos;ve accepted our quote and it&apos;s confirmed.</p>
      <dl className="mt-8 divide-y divide-line border-y border-line text-sm">
        {rows
          .filter((r): r is [string, string] => !!r[1])
          .map(([k, v]) => (
            <div key={k} className="grid gap-1 py-3 sm:grid-cols-3">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="whitespace-pre-line text-ink sm:col-span-2">{v}</dd>
            </div>
          ))}
      </dl>
    </Container>
  );
}
