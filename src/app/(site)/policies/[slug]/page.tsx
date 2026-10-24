import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container, SectionHeading } from "@/components/ui/container";
import { Prose } from "@/components/ui/prose";
import { getPage } from "@/lib/content";

export async function generateMetadata({ params }: PageProps<"/policies/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) return {};
  return { title: page.seoTitle ?? page.title, description: page.seoDescription ?? undefined, alternates: { canonical: `/policies/${page.slug}` } };
}

export default async function PolicyPage({ params }: PageProps<"/policies/[slug]">) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page || page.kind !== "policy") notFound();
  return (
    <Container size="narrow" className="py-12 lg:py-20">
      <SectionHeading as="h1" title={page.title} />
      <Prose text={page.body} className="mt-8" />
      <p className="mt-10 text-sm text-ink-muted">Last updated {page.updatedAt.toLocaleDateString("en-US", { dateStyle: "long" })}</p>
    </Container>
  );
}
