import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { CategoryNav } from "@/components/shop/category-nav";
import { ProductGrid } from "@/components/shop/product-card";
import { Container, SectionHeading } from "@/components/ui/container";
import { getCategoryBySlug, listPublicCategories, listPublicProducts, newSince } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";

export async function generateMetadata({ params }: PageProps<"/shop/[category]">): Promise<Metadata> {
  const { category } = await params;
  const c = await getCategoryBySlug(category);
  if (!c) return {};
  return {
    title: c.seoTitle ?? c.name,
    description: c.seoDescription ?? c.description ?? undefined,
    alternates: { canonical: `/shop/${c.slug}` },
  };
}

export default async function CategoryPage({ params }: PageProps<"/shop/[category]">) {
  const { category } = await params;
  const c = await getCategoryBySlug(category);
  if (!c) notFound();
  const [products, categories, settings] = await Promise.all([listPublicProducts({ categoryId: c.id }), listPublicCategories(), getSettings()]);
  return (
    <Container className="py-12 lg:py-16">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Shop", path: "/shop" }, { name: c.name, path: `/shop/${c.slug}` }]} />
      <div className="mt-6">
        <SectionHeading as="h1" title={c.name} intro={c.description ?? undefined} />
      </div>
      <div className="mt-10">
        <CategoryNav categories={categories} active={c.slug} />
      </div>
      <div className="mt-10">
        {products.length ? <ProductGrid products={products} newSince={newSince(settings.newArrivalDays)} /> : <p className="text-ink-soft">There&apos;s nothing in this category right now.</p>}
      </div>
    </Container>
  );
}
