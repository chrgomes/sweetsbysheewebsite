import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/shop/add-to-cart";
import { ProductGrid } from "@/components/shop/product-card";
import { ProductGallery } from "@/components/shop/product-gallery";
import { Price } from "@/components/shop/price";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { JsonLd } from "@/components/site/json-ld";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { FormAlert } from "@/components/ui/field";
import { Prose } from "@/components/ui/prose";
import { adminCan } from "@/lib/auth/session";
import { fromPrice, getProductBySlug, listRelatedProducts } from "@/lib/catalog";
import { describeHours } from "@/lib/dates";
import { paymentProvider } from "@/lib/payments";
import { isPurchasable, MAX_LINE_QUANTITY } from "@/lib/pricing";
import { productJsonLd } from "@/lib/seo/structured-data";
import { checkoutReadiness, getSettings } from "@/lib/settings";

export async function generateMetadata({ params, searchParams }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { product: p, isPreview } = await loadProduct(slug, (await searchParams).preview);
  if (!p) return {};
  if (isPreview) return { title: `Preview: ${p.name}`, robots: { index: false, follow: false } };
  const description = p.seoDescription ?? p.summary ?? p.description?.slice(0, 160) ?? undefined;
  return {
    title: p.seoTitle ?? p.name,
    description,
    alternates: { canonical: `/products/${p.slug}` },
    openGraph: { title: p.name, description, images: p.images[0] ? [{ url: p.images[0].src, alt: p.images[0].alt }] : undefined },
  };
}

/** `?preview=1` lets signed-in staff see draft products exactly as customers would. */
async function loadProduct(slug: string, preview: unknown) {
  const isPreview = preview === "1" && !!(await adminCan("products:view"));
  return { product: await getProductBySlug(slug, { preview: isPreview }), isPreview };
}

export default async function ProductPage({ params, searchParams }: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  const { product, isPreview } = await loadProduct(slug, (await searchParams).preview);
  if (!product) notFound();
  const hidden = product.status === "draft" || product.status === "archived";
  const [settings, related] = await Promise.all([getSettings(), listRelatedProducts(product.id, product.categoryId)]);
  const checkoutOpen = checkoutReadiness(settings, paymentProvider() !== null).ready;
  const purchasable = isPurchasable(product);
  const price = fromPrice(product);
  const lead = Math.max(product.leadTimeHours ?? 0, settings.minLeadTimeHours);

  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Shop", path: "/shop" },
    ...(product.category ? [{ name: product.category.name, path: `/shop/${product.category.slug}` }] : []),
    { name: product.name, path: `/products/${product.slug}` },
  ];

  const details: [string, string | null][] = [
    ["Serves", product.servings],
    ["Ingredients", product.ingredients],
    ["Allergens", product.allergens],
  ];

  return (
    <>
      {!hidden && <JsonLd data={productJsonLd(product)} />}
      <Container className="py-8 lg:py-12">
        {isPreview && (
          <div className="mb-6">
            <FormAlert tone="info">Staff preview{hidden ? ` — this product is ${product.status} and hidden from customers` : ""}. Online ordering is disabled in preview.</FormAlert>
          </div>
        )}
        <Breadcrumbs items={crumbs} />
        <div className="mt-8 grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:col-span-7 lg:self-start">
            <ProductGallery name={product.name} images={product.images} />
          </div>
          <div className="lg:col-span-5">
            {product.category && <p className="text-xs tracking-[0.18em] text-ink-muted uppercase">{product.category.name}</p>}
            <h1 className="mt-2 text-4xl leading-tight font-light text-ink sm:text-5xl">{product.name}</h1>
            {product.summary && <p className="mt-4 text-lg text-ink-soft">{product.summary}</p>}

            <div className="mt-8">
              {product.status === "unavailable" ? (
                <FormAlert tone="info">This item is currently unavailable.</FormAlert>
              ) : purchasable && checkoutOpen ? (
                <AddToCart
                  productId={product.id}
                  basePriceCents={product.basePriceCents!}
                  currency={product.currency}
                  options={product.options.map((o) => ({ id: o.id, name: o.name, kind: o.kind, required: o.required, maxLength: o.maxLength, priceDeltaCents: o.priceDeltaCents, helpText: o.helpText, values: o.values }))}
                  maxQuantity={Math.min(product.maxPerOrder ?? MAX_LINE_QUANTITY, MAX_LINE_QUANTITY)}
                />
              ) : (
                <div className="space-y-4">
                  <p className="text-3xl text-ink">
                    <Price cents={price?.cents ?? null} from={price?.isFrom} currency={product.currency} />
                  </p>
                  {product.options.length > 0 && (
                    <dl className="space-y-3 text-sm">
                      {product.options.map((o) => (
                        <div key={o.id}>
                          <dt className="font-medium text-ink">{o.name}</dt>
                          <dd className="text-ink-soft">{o.kind === "text" ? `Personalised${o.maxLength ? ` (up to ${o.maxLength} characters)` : ""}` : o.values.map((v) => v.label).join(" · ")}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {purchasable && <FormAlert tone="info">Online checkout is coming soon. Please contact us to order.</FormAlert>}
                </div>
              )}
            </div>

            {product.customOrder && settings.customOrdersEnabled && (
              <div className="mt-6 rounded-2xl border border-line bg-paper p-5">
                <p className="text-sm text-ink-soft">{purchasable ? "Want a different size, design or message?" : "This is made to order. Tell us about your event and we'll send a quote."}</p>
                <ButtonLink href={`/custom-orders?product=${product.slug}`} variant="secondary" size="sm" className="mt-3">
                  Request a custom version
                </ButtonLink>
              </div>
            )}

            <ul className="mt-8 flex flex-wrap gap-2">
              {lead > 0 && <li><Badge tone="honey">{describeHours(lead)} notice</Badge></li>}
              {product.pickupEligible && settings.pickupEnabled && <li><Badge tone="sage">Pickup</Badge></li>}
              {product.deliveryEligible && settings.deliveryEnabled && <li><Badge tone="sage">Delivery</Badge></li>}
            </ul>

            {product.description && (
              <section aria-labelledby="desc-heading" className="mt-10 border-t border-line pt-8">
                <h2 id="desc-heading" className="text-xl text-ink">About this treat</h2>
                <Prose text={product.description} className="mt-4" />
              </section>
            )}

            {details.some(([, v]) => v) && (
              <dl className="mt-8 divide-y divide-line border-y border-line text-sm">
                {details.map(([label, value]) =>
                  value ? (
                    <div key={label} className="grid grid-cols-3 gap-4 py-4">
                      <dt className="font-medium text-ink">{label}</dt>
                      <dd className="col-span-2 whitespace-pre-line text-ink-soft">{value}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            )}
            {!product.allergens && (
              <p className="mt-6 text-sm text-ink-muted">Have an allergy or dietary requirement? Please contact us before ordering.</p>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section aria-labelledby="related-heading" className="mt-24">
            <h2 id="related-heading" className="text-3xl text-ink">You may also like</h2>
            <div className="mt-8">
              <ProductGrid products={related} />
            </div>
          </section>
        )}
      </Container>
    </>
  );
}
