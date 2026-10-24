import type { Metadata } from "next";
import { ProductImage } from "@/components/shop/product-image";
import { ButtonLink } from "@/components/ui/button";
import { Container, SectionHeading } from "@/components/ui/container";
import { listGallery } from "@/lib/content";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Gallery",
  description: "A look at cakes and desserts we've made for celebrations.",
  alternates: { canonical: "/gallery" },
};

export default async function GalleryPage() {
  const [items, s] = await Promise.all([listGallery(), getSettings()]);
  const collections = [...new Set(items.map((i) => i.collection).filter(Boolean))] as string[];
  const groups = collections.length ? collections.map((c) => ({ name: c, items: items.filter((i) => i.collection === c) })).concat(items.some((i) => !i.collection) ? [{ name: "More", items: items.filter((i) => !i.collection) }] : []) : [{ name: "", items }];
  return (
    <Container size="wide" className="py-12 lg:py-20">
      <SectionHeading as="h1" eyebrow="Gallery" title="Recent creations" intro={s.customOrdersEnabled ? "Inspired? Every piece can be a starting point for your own custom order." : undefined} />
      {items.length === 0 ? (
        <p className="mt-10 text-lg text-ink-soft">Our gallery is coming soon.</p>
      ) : (
        groups.map((g) => (
          <section key={g.name || "all"} aria-label={g.name || "Gallery"} className="mt-12">
            {g.name && <h2 className="mb-6 text-2xl text-ink">{g.name}</h2>}
            <ul className="columns-2 gap-4 sm:columns-3 lg:columns-4 [&>li]:mb-4">
              {g.items.map((it) => (
                <li key={it.id} className="break-inside-avoid">
                  <figure>
                    <ProductImage src={it.src} alt={it.alt} name={it.caption ?? s.businessName} aspect={it.width && it.height && it.height > it.width ? "aspect-[4/5]" : "aspect-square"} sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" />
                    {it.caption && <figcaption className="mt-2 text-sm text-ink-soft">{it.caption}</figcaption>}
                  </figure>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {s.customOrdersEnabled && (
        <div className="mt-16 text-center">
          <ButtonLink href="/custom-orders" size="lg">Request a custom order</ButtonLink>
        </div>
      )}
    </Container>
  );
}
