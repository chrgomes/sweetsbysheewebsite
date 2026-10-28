import type { Metadata } from "next";
import Link from "next/link";
import { CategoryNav } from "@/components/shop/category-nav";
import { ProductGrid } from "@/components/shop/product-card";
import { ButtonLink } from "@/components/ui/button";
import { Container, SectionHeading } from "@/components/ui/container";
import { FormAlert } from "@/components/ui/field";
import { listActiveCollections, listPublicCategories, listPublicProducts, newSince } from "@/lib/catalog";
import { dateInZone } from "@/lib/dates";
import { paymentProvider } from "@/lib/payments";
import { checkoutReadiness, getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Shop",
  description: "Browse cakes, treats and desserts, with sizes, flavours and prices.",
  alternates: { canonical: "/shop" },
};

export default async function ShopPage() {
  const settings = await getSettings();
  const [products, categories, collections] = await Promise.all([listPublicProducts(), listPublicCategories(), listActiveCollections(dateInZone(new Date(), settings.timezone))]);
  const checkoutOpen = checkoutReadiness(settings, paymentProvider() !== null).ready;
  return (
    <Container className="py-12 lg:py-16">
      <SectionHeading as="h1" eyebrow="The menu" title="Shop our treats" intro={checkoutOpen ? "Order online for pickup or delivery, or request something made just for you." : undefined} />
      {!checkoutOpen && products.some((p) => p.directPurchase) && (
        <div className="mt-8 max-w-2xl">
          <FormAlert tone="info">Online checkout is coming soon. To order something from the menu, please contact us or send a custom request.</FormAlert>
        </div>
      )}
      <div className="mt-10">
        <CategoryNav categories={categories} />
      </div>
      {collections.length > 0 && (
        <nav aria-label="Collections" className="mt-6 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">Collections:</span>
          {collections.map((c) => (
            <Link key={c.id} href={`/collections/${c.slug}`} className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-ink hover:border-berry/40 hover:bg-blush/40">
              {c.name}
            </Link>
          ))}
        </nav>
      )}
      <div className="mt-10">
        {products.length ? (
          <ProductGrid products={products} newSince={newSince(settings.newArrivalDays)} />
        ) : (
          <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-paper px-6 py-14 text-center">
            <p className="font-display text-2xl text-ink">Our menu is being updated.</p>
            <p className="mt-3 text-ink-soft">Please check back soon.</p>
            {settings.customOrdersEnabled && <ButtonLink href="/custom-orders" className="mt-6">Request a custom order</ButtonLink>}
          </div>
        )}
      </div>
    </Container>
  );
}
