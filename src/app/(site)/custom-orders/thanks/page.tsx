import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { db, schema } from "@/db";
import { ButtonLink } from "@/components/ui/button";
import { Container, Eyebrow } from "@/components/ui/container";

export const metadata: Metadata = { title: "Request received", robots: { index: false } };

export default async function ThanksPage({ searchParams }: PageProps<"/custom-orders/thanks">) {
  const { ref } = await searchParams;
  const reference = typeof ref === "string" && /^REQ-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(ref) ? ref : null;
  const row = reference
    ? await db().query.inquiries.findFirst({ where: eq(schema.inquiries.reference, reference), columns: { customerEmailStatus: true } })
    : undefined;
  return (
    <Container size="narrow" className="py-16 text-center lg:py-24">
      <Eyebrow>Request received</Eyebrow>
      <h1 className="mt-3 text-4xl font-light text-ink sm:text-5xl">Thank you — we&apos;ve got your request</h1>
      {reference && (
        <p className="mt-6 text-lg text-ink-soft">
          Your reference is <strong className="font-semibold text-ink">{reference}</strong>. Please keep it handy if you contact us.
        </p>
      )}
      <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-honey/30 bg-honey-tint px-6 py-5 text-left text-[#5c4322]">
        <p className="font-medium">What happens next</p>
        <p className="mt-2 text-sm">
          This is a request, not a confirmed order. We&apos;ll review the details and reply by email about availability and pricing. Your date is only booked once we confirm it with you.{row?.customerEmailStatus === "sent" && " We've also emailed you a copy of your request."}
        </p>
      </div>
      <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
        <ButtonLink href="/shop" variant="secondary">Browse the menu</ButtonLink>
        <ButtonLink href="/">Back to home</ButtonLink>
      </div>
    </Container>
  );
}
