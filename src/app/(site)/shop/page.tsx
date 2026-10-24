import type { Metadata } from "next";
import { CategoryNav } from "@/components/shop/category-nav";
import { ProductGrid } from "@/components/shop/product-card";
import { ButtonLink } from "@/components/ui/button";
import { Container, SectionHeading } from "@/components/ui/container";
import { FormAlert } from "@/components/ui/field";
import { listPublicCategories, listPublicProducts } from "@/lib/catalog";
import { paymentProvider } from "@/lib/payments";
import { checkoutReadiness, getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Shop",
  description: "Browse cakes, treats and desserts, with sizes, flavours and prices.",
  alternates: { canonical: "/shop" },
};

export default async function ShopPage() {
  const [products, categories, settings] = await Promise.all([listPublicProducts(), listPublicCategories(), getSettings()]);
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
      <div className="mt-10">
        {products.length ? (
          <ProductGrid products={products} />
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
