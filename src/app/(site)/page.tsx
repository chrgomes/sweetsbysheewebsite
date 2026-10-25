import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ProductGrid } from "@/components/shop/product-card";
import { ProductImage } from "@/components/shop/product-image";
import { FaqList } from "@/components/site/faq-list";
import { ButtonLink } from "@/components/ui/button";
import { Container, Eyebrow, SectionHeading } from "@/components/ui/container";
import { Prose } from "@/components/ui/prose";
import { listPublicCategories, listPublicProducts } from "@/lib/catalog";
import { BRAND_ASSETS } from "@/lib/brand";
import { listFaqs, listGallery, listTestimonials } from "@/lib/content";
import { describeHours } from "@/lib/dates";
import { paymentProvider } from "@/lib/payments";
import { checkoutReadiness, getSettings } from "@/lib/settings";
import { organizationJsonLd } from "@/lib/seo/structured-data";
import { JsonLd } from "@/components/site/json-ld";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return {
    title: { absolute: s.tagline ? `${s.businessName} — ${s.tagline}` : s.businessName },
    description: s.heroSubheading ?? s.tagline ?? undefined,
    alternates: { canonical: "/" },
    openGraph: { title: s.businessName, description: s.heroSubheading ?? s.tagline ?? undefined, images: s.heroImage ? [s.heroImage] : undefined, type: "website" },
  };
}

export default async function HomePage() {
  const [settings, featured, allProducts, categories, gallery, testimonials, faqs] = await Promise.all([
    getSettings(),
    listPublicProducts({ featuredOnly: true, limit: 6 }),
    listPublicProducts({ limit: 6 }),
    listPublicCategories(),
    listGallery({ limit: 8 }),
    listTestimonials(3),
    listFaqs(),
  ]);
  const showcase = featured.length ? featured : allProducts;
  const checkoutOpen = checkoutReadiness(settings, paymentProvider() !== null).ready;
  const heroImage = settings.heroImage ?? showcase.find((p) => p.images[0])?.images[0]?.src ?? null;
  const heroAlt = settings.heroImage ? (settings.heroImageAlt ?? "") : (showcase.find((p) => p.images[0])?.images[0]?.alt ?? "");

  return (
    <>
      <JsonLd data={organizationJsonLd(settings)} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <Container className="grid items-center gap-10 pt-10 pb-16 lg:grid-cols-12 lg:gap-16 lg:pt-16 lg:pb-24">
          <div className="animate-rise lg:col-span-6">
            {settings.tagline && <Eyebrow className="mb-5">{settings.tagline}</Eyebrow>}
            <h1 className="text-[2.75rem] leading-[1.02] font-light text-ink sm:text-6xl lg:text-7xl">
              {settings.heroHeading ?? settings.businessName}
            </h1>
            {settings.heroSubheading && <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft sm:text-xl">{settings.heroSubheading}</p>}
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/shop" size="lg">
                {checkoutOpen ? "Shop & order online" : "Browse the menu"}
              </ButtonLink>
              {settings.customOrdersEnabled && (
                <ButtonLink href="/custom-orders" variant="secondary" size="lg">
                  Request a custom order
                </ButtonLink>
              )}
            </div>
          </div>
          <div className="lg:col-span-6">
            {heroImage ? (
              <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] shadow-[var(--shadow-lift)] sm:aspect-[5/4] lg:aspect-[4/5]">
                <Image src={heroImage} alt={heroAlt} fill priority sizes="(min-width: 1024px) 50vw, 100vw" quality={85} className="object-cover" />
              </div>
            ) : (
              <div className="relative grid aspect-[5/4] place-items-center overflow-hidden rounded-[2rem] bg-blush/60 lg:aspect-[4/5]">
                <div aria-hidden="true" className="absolute inset-6 rounded-[1.5rem] border border-rose/30 sm:inset-8" />
                <Image
                  src={settings.logoImage ?? BRAND_ASSETS.logo}
                  alt={`${settings.businessName} logo`}
                  width={520}
                  height={520}
                  priority
                  sizes="(min-width: 1024px) 420px, 70vw"
                  className="w-[70%] max-w-[26rem] drop-shadow-[0_18px_40px_rgb(86_42_18/0.12)]"
                />
              </div>
            )}
          </div>
        </Container>
      </section>

      {/* Featured products */}
      <section aria-labelledby="featured-heading" className="py-16 lg:py-24">
        <Container>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading id="featured-heading" eyebrow="From the kitchen" title={featured.length ? "Customer favourites" : "On the menu"} />
            {showcase.length > 0 && (
              <Link href="/shop" className="text-sm font-medium text-berry underline-offset-4 hover:underline">
                See everything →
              </Link>
            )}
          </div>
          <div className="mt-12">
            {showcase.length ? (
              <ProductGrid products={showcase} />
            ) : (
              <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-paper px-6 py-14 text-center">
                <p className="font-display text-2xl text-ink">Our menu is being updated.</p>
                <p className="mx-auto mt-3 max-w-md text-ink-soft">
                  {settings.customOrdersEnabled ? "In the meantime, we'd love to hear about your celebration." : "Please check back soon."}
                </p>
                {settings.customOrdersEnabled && (
                  <ButtonLink href="/custom-orders" className="mt-6">
                    Request a custom order
                  </ButtonLink>
                )}
              </div>
            )}
          </div>
        </Container>
      </section>

      {/* Categories */}
      {categories.length > 1 && (
        <section aria-labelledby="categories-heading" className="border-y border-line bg-paper py-16 lg:py-20">
          <Container>
            <SectionHeading id="categories-heading" eyebrow="Browse" title="Find your treat" />
            <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {categories.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/shop/${c.slug}`}
                    className="group flex h-full min-h-28 flex-col justify-between rounded-[var(--radius-card)] border border-line bg-cream p-6 transition-colors hover:border-berry/40 hover:bg-blush/40"
                  >
                    <span className="font-display text-2xl text-ink">{c.name}</span>
                    <span className="mt-4 text-sm text-berry transition-transform group-hover:translate-x-1" aria-hidden="true">
                      Explore →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}

      {/* Custom orders */}
      {settings.customOrdersEnabled && (
        <section aria-labelledby="custom-heading" className="py-16 lg:py-24">
          <Container>
            <div className="grid gap-10 overflow-hidden rounded-[2rem] bg-ink px-6 py-12 text-cream sm:px-12 lg:grid-cols-12 lg:gap-16 lg:px-16 lg:py-16">
              <div className="lg:col-span-5">
                <Eyebrow className="text-petal">Celebrations & events</Eyebrow>
                <h2 id="custom-heading" className="mt-3 text-4xl leading-tight font-light sm:text-5xl">
                  Something made just for you
                </h2>
                <p className="mt-5 text-lg text-cream/80">
                  Tell us about your occasion — the date, the guest count and the look you&apos;re dreaming of — and we&apos;ll come back to you with a personal quote.
                </p>
                <ButtonLink href="/custom-orders" size="lg" variant="light" className="mt-8">
                  Start a custom request
                </ButtonLink>
              </div>
              <ol className="grid gap-6 sm:grid-cols-3 lg:col-span-7 lg:self-center">
                {[
                  ["Share your idea", "Fill in the request form with your date, servings and inspiration photos."],
                  ["Get a quote", "We review every request personally and reply with availability and pricing."],
                  ["Confirm & enjoy", `Your date is booked once we've agreed the details${checkoutOpen ? " and payment is complete" : ""}.`],
                ].map(([title, body], i) => (
                  <li key={title} className="rounded-2xl border border-cream/15 p-6">
                    <span className="font-display text-3xl text-petal">{i + 1}</span>
                    <h3 className="mt-3 text-xl">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-cream/75">{body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </Container>
        </section>
      )}

      {/* Story */}
      {settings.storyBody && (
        <section aria-labelledby="story-heading" className="py-16 lg:py-24">
          <Container className="grid items-center gap-12 lg:grid-cols-12">
            {settings.storyImage && (
              <div className="lg:col-span-5">
                <ProductImage src={settings.storyImage} alt={settings.storyImageAlt ?? ""} name={settings.businessName} sizes="(min-width: 1024px) 40vw, 100vw" />
              </div>
            )}
            <div className={settings.storyImage ? "lg:col-span-6 lg:col-start-7" : "lg:col-span-8"}>
              <SectionHeading id="story-heading" eyebrow="Our story" title={settings.storyHeading ?? `About ${settings.businessName}`} />
              <Prose text={settings.storyBody} className="mt-6 text-lg" />
              <ButtonLink href="/about" variant="secondary" className="mt-8">
                Read more
              </ButtonLink>
            </div>
          </Container>
        </section>
      )}

      {/* Gallery */}
      {gallery.length > 0 && (
        <section aria-labelledby="gallery-heading" className="py-16 lg:py-24">
          <Container size="wide">
            <div className="flex flex-col gap-6 px-0 sm:flex-row sm:items-end sm:justify-between">
              <SectionHeading id="gallery-heading" eyebrow="Gallery" title="Recent creations" />
              <Link href="/gallery" className="text-sm font-medium text-berry underline-offset-4 hover:underline">
                View the gallery →
              </Link>
            </div>
            <ul className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {gallery.map((g, i) => (
                <li key={g.id} className={i === 0 ? "col-span-2 row-span-2" : ""}>
                  <ProductImage src={g.src} alt={g.alt} name={g.caption ?? settings.businessName} aspect="aspect-square" sizes={i === 0 ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"} />
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}

      {/* How ordering works */}
      <section aria-labelledby="how-heading" className="border-y border-line bg-paper py-16 lg:py-24">
        <Container>
          <SectionHeading id="how-heading" eyebrow="How to order" title="Two easy ways to order" align="center" />
          <div className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-2">
            <div className="rounded-[var(--radius-card)] border border-line bg-cream p-8">
              <h3 className="text-2xl text-ink">Order from the menu</h3>
              <p className="mt-3 text-ink-soft">
                {checkoutOpen
                  ? `Choose your treats, pick a ${settings.pickupEnabled && settings.deliveryEnabled ? "pickup or delivery" : settings.deliveryEnabled ? "delivery" : "pickup"} date and pay securely online.${settings.minLeadTimeHours ? ` Please allow at least ${describeHours(settings.minLeadTimeHours)} notice.` : ""}`
                  : "Browse our menu for flavours, sizes and prices. Online checkout is coming soon — in the meantime, get in touch to order."}
              </p>
              <ButtonLink href="/shop" variant="secondary" className="mt-6">
                Browse the menu
              </ButtonLink>
            </div>
            {settings.customOrdersEnabled && (
              <div className="rounded-[var(--radius-card)] border border-line bg-cream p-8">
                <h3 className="text-2xl text-ink">Request something custom</h3>
                <p className="mt-3 text-ink-soft">
                  For personalised cakes, event orders and anything not on the menu, send a request. It isn&apos;t a confirmed booking until we&apos;ve replied and agreed the details with you.
                  {settings.customOrderMinNoticeDays > 0 && ` Please allow at least ${settings.customOrderMinNoticeDays} days' notice.`}
                </p>
                <ButtonLink href="/custom-orders" variant="secondary" className="mt-6">
                  Start a request
                </ButtonLink>
              </div>
            )}
          </div>
        </Container>
      </section>

      {/* Testimonials (owner-verified only) */}
      {testimonials.length > 0 && (
        <section aria-labelledby="reviews-heading" className="py-16 lg:py-24">
          <Container>
            <SectionHeading id="reviews-heading" eyebrow="Kind words" title="From our customers" align="center" />
            <ul className="mt-12 grid gap-6 md:grid-cols-3">
              {testimonials.map((t) => (
                <li key={t.id}>
                  <figure className="flex h-full flex-col rounded-[var(--radius-card)] bg-paper p-8 shadow-[var(--shadow-soft)]">
                    <blockquote className="flex-1 font-display text-xl leading-relaxed text-ink italic">“{t.quote}”</blockquote>
                    <figcaption className="mt-6 text-sm text-ink-muted">
                      — {t.author}
                      {t.context && <span>, {t.context}</span>}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}

      {/* FAQs */}
      {faqs.length > 0 && (
        <section aria-labelledby="faq-heading" className="py-16 lg:py-24">
          <Container size="narrow">
            <SectionHeading id="faq-heading" eyebrow="Good to know" title="Frequently asked questions" align="center" />
            <FaqList faqs={faqs.slice(0, 5)} className="mt-10" />
            {faqs.length > 5 && (
              <p className="mt-8 text-center">
                <Link href="/faq" className="font-medium text-berry underline-offset-4 hover:underline">
                  All questions →
                </Link>
              </p>
            )}
          </Container>
        </section>
      )}

      {/* Contact CTA + social */}
      <section aria-labelledby="contact-heading" className="pt-8 pb-8">
        <Container>
          <div className="rounded-[2rem] bg-blush/60 px-6 py-14 text-center sm:px-12">
            <h2 id="contact-heading" className="text-3xl text-ink sm:text-4xl">
              Have a question?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft">We&apos;re happy to help with flavours, sizes, dates and anything else.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <ButtonLink href="/contact">Contact us</ButtonLink>
              {settings.socialLinks.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-full border border-line-strong bg-paper px-6 text-[0.95rem] font-medium text-ink hover:border-ink">
                  {s.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ))}
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
