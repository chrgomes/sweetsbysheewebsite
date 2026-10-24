import type { Metadata } from "next";
import { ProductImage } from "@/components/shop/product-image";
import { ButtonLink } from "@/components/ui/button";
import { Container, SectionHeading } from "@/components/ui/container";
import { Prose } from "@/components/ui/prose";
import { getPage } from "@/lib/content";
import { getSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const [page, s] = await Promise.all([getPage("about"), getSettings()]);
  return {
    title: page?.seoTitle ?? page?.title ?? `About ${s.businessName}`,
    description: page?.seoDescription ?? s.storyBody?.slice(0, 160) ?? undefined,
    alternates: { canonical: "/about" },
  };
}

export default async function AboutPage() {
  const [page, s] = await Promise.all([getPage("about"), getSettings()]);
  const body = page?.body ?? s.storyBody;
  return (
    <Container className="py-12 lg:py-20">
      <div className="grid gap-12 lg:grid-cols-12">
        <div className={s.storyImage ? "lg:col-span-6" : "lg:col-span-8"}>
          <SectionHeading as="h1" eyebrow="Our story" title={page?.title ?? s.storyHeading ?? `About ${s.businessName}`} />
          {body ? (
            <Prose text={body} className="mt-8 text-lg" />
          ) : (
            <p className="mt-8 text-lg text-ink-soft">Our story is coming soon.</p>
          )}
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/shop">Browse the menu</ButtonLink>
            {s.customOrdersEnabled && <ButtonLink href="/custom-orders" variant="secondary">Request a custom order</ButtonLink>}
          </div>
        </div>
        {s.storyImage && (
          <div className="lg:col-span-5 lg:col-start-8">
            <ProductImage src={s.storyImage} alt={s.storyImageAlt ?? ""} name={s.businessName} priority sizes="(min-width: 1024px) 40vw, 100vw" />
          </div>
        )}
      </div>
    </Container>
  );
}
