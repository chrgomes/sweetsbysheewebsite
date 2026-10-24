import type { Metadata } from "next";
import Link from "next/link";
import { FaqList } from "@/components/site/faq-list";
import { JsonLd } from "@/components/site/json-ld";
import { Container, SectionHeading } from "@/components/ui/container";
import { listFaqs } from "@/lib/content";
import { faqJsonLd } from "@/lib/seo/structured-data";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description: "Answers about ordering, lead times, pickup, delivery and allergies.",
  alternates: { canonical: "/faq" },
};

export default async function FaqPage() {
  const faqs = await listFaqs();
  return (
    <Container size="narrow" className="py-12 lg:py-20">
      <JsonLd data={faqJsonLd(faqs)} />
      <SectionHeading as="h1" eyebrow="Good to know" title="Frequently asked questions" />
      {faqs.length ? (
        <FaqList faqs={faqs} className="mt-10" />
      ) : (
        <p className="mt-8 text-lg text-ink-soft">
          Questions? We&apos;re happy to help — <Link href="/contact" className="text-berry underline underline-offset-4">get in touch</Link>.
        </p>
      )}
    </Container>
  );
}
