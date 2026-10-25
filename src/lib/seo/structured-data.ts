import { BRAND_ASSETS } from "@/lib/brand";
import { siteUrl } from "@/lib/env";
import type { SiteSettings } from "@/lib/settings";

/**
 * Schema.org data built only from verified, owner-entered fields. Nothing is
 * filled in when unknown: no invented address, ratings, review counts or hours.
 */
export function organizationJsonLd(s: SiteSettings) {
  return {
    "@context": "https://schema.org",
    "@type": "Bakery",
    name: s.businessName,
    url: siteUrl("/"),
    ...(s.tagline ? { slogan: s.tagline } : {}),
    ...(s.contactEmail ? { email: s.contactEmail } : {}),
    ...(s.contactPhone ? { telephone: s.contactPhone } : {}),
    logo: siteUrl(s.logoImage ?? BRAND_ASSETS.logo),
    ...(s.heroImage ? { image: siteUrl(s.heroImage) } : {}),
    ...(s.socialLinks.length ? { sameAs: s.socialLinks.map((l) => l.url) } : {}),
    ...(s.showAddress && s.addressLines.length ? { address: { "@type": "PostalAddress", streetAddress: s.addressLines.join(", ") } } : {}),
    ...(s.serviceArea ? { areaServed: s.serviceArea } : {}),
  };
}

export function productJsonLd(p: {
  name: string;
  slug: string;
  summary: string | null;
  description: string | null;
  images: { src: string }[];
  basePriceCents: number | null;
  currency: string;
  status: string;
  directPurchase: boolean;
  category?: { name: string } | null;
}) {
  const offer =
    p.directPurchase && p.basePriceCents !== null
      ? {
          offers: {
            "@type": "Offer",
            price: (p.basePriceCents / 100).toFixed(2),
            priceCurrency: p.currency.toUpperCase(),
            availability: p.status === "active" ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            url: siteUrl(`/products/${p.slug}`),
          },
        }
      : {};
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    url: siteUrl(`/products/${p.slug}`),
    ...(p.summary || p.description ? { description: p.summary ?? p.description } : {}),
    ...(p.images.length ? { image: p.images.map((i) => siteUrl(i.src)) } : {}),
    ...(p.category ? { category: p.category.name } : {}),
    ...offer,
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: siteUrl(it.path) })),
  };
}

export function faqJsonLd(faqs: { question: string; answer: string }[]) {
  if (!faqs.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
  };
}
