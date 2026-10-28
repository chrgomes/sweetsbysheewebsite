import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { ProductGrid } from "@/components/shop/product-card";
import { Container, SectionHeading } from "@/components/ui/container";
import { getCollectionBySlug, newSince } from "@/lib/catalog";
import { dateInZone, formatDate } from "@/lib/dates";
import { getSettings } from "@/lib/settings";

async function load(slug: string) {
  const settings = await getSettings();
  const collection = await getCollectionBySlug(slug, dateInZone(new Date(), settings.timezone));
  return { settings, collection };
}

export async function generateMetadata({ params }: PageProps<"/collections/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { collection } = await load(slug);
  if (!collection) return {};
  return { title: collection.name, description: collection.description ?? undefined, alternates: { canonical: `/collections/${collection.slug}` } };
}

export default async function CollectionPage({ params }: PageProps<"/collections/[slug]">) {
  const { slug } = await params;
  const { settings, collection } = await load(slug);
  if (!collection) notFound();
  return (
    <Container className="py-12 lg:py-16">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Shop", path: "/shop" }, { name: collection.name, path: `/collections/${collection.slug}` }]} />
      <div className="mt-6">
        <SectionHeading as="h1" eyebrow="Collection" title={collection.name} intro={collection.description ?? undefined} />
        {collection.endsOn && <p className="mt-4 text-sm text-ink-muted">Available until {formatDate(collection.endsOn)}.</p>}
      </div>
      <div className="mt-10">
        <ProductGrid products={collection.products} newSince={newSince(settings.newArrivalDays)} />
      </div>
    </Container>
  );
}
