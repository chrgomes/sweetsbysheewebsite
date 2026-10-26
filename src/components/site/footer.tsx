import Image from "next/image";
import Link from "next/link";
import { BRAND_ASSETS } from "@/lib/brand";
import { Container } from "@/components/ui/container";
import type { SiteSettings } from "@/lib/settings";

export function SiteFooter({ settings, policies }: { settings: SiteSettings; policies: { slug: string; title: string }[] }) {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t border-line bg-paper">
      <Container className="grid gap-12 py-16 md:grid-cols-12">
        <div className="md:col-span-5">
          <Image src={settings.logoImage ?? BRAND_ASSETS.logo} alt={`${settings.businessName} logo`} width={144} height={144} className="size-32 sm:size-36" />
          {settings.tagline && <p className="mt-3 max-w-sm text-ink-soft">{settings.tagline}</p>}
          {settings.serviceArea && <p className="mt-3 text-sm text-ink-muted">{settings.serviceArea}</p>}
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 text-sm md:col-span-4">
          <div>
            <h2 className="font-sans text-xs font-semibold tracking-[0.18em] text-ink-muted uppercase">Shop</h2>
            <ul className="mt-4 space-y-3">
              <li><Link className="text-ink hover:text-berry" href="/shop">All treats</Link></li>
              {settings.customOrdersEnabled && <li><Link className="text-ink hover:text-berry" href="/custom-orders">Custom orders</Link></li>}
              <li><Link className="text-ink hover:text-berry" href="/gallery">Gallery</Link></li>
              <li><Link className="text-ink hover:text-berry" href="/cart">Cart</Link></li>
              <li><Link className="text-ink hover:text-berry" href="/orders/find">Find my orders</Link></li>
            </ul>
          </div>
          <div>
            <h2 className="font-sans text-xs font-semibold tracking-[0.18em] text-ink-muted uppercase">About</h2>
            <ul className="mt-4 space-y-3">
              <li><Link className="text-ink hover:text-berry" href="/about">Our story</Link></li>
              <li><Link className="text-ink hover:text-berry" href="/faq">FAQ</Link></li>
              <li><Link className="text-ink hover:text-berry" href="/contact">Contact</Link></li>
              {policies.map((p) => (
                <li key={p.slug}><Link className="text-ink hover:text-berry" href={`/policies/${p.slug}`}>{p.title}</Link></li>
              ))}
            </ul>
          </div>
        </nav>
        <div className="text-sm md:col-span-3">
          <h2 className="font-sans text-xs font-semibold tracking-[0.18em] text-ink-muted uppercase">Get in touch</h2>
          <ul className="mt-4 space-y-3">
            {settings.contactEmail && <li><a className="break-all text-ink hover:text-berry" href={`mailto:${settings.contactEmail}`}>{settings.contactEmail}</a></li>}
            {settings.contactPhone && <li><a className="text-ink hover:text-berry" href={`tel:${settings.contactPhone.replace(/[^\d+]/g, "")}`}>{settings.contactPhone}</a></li>}
            {settings.socialLinks.map((s) => (
              <li key={s.url}><a className="text-ink hover:text-berry" href={s.url} rel="noopener noreferrer" target="_blank">{s.label}<span className="sr-only"> (opens in a new tab)</span></a></li>
            ))}
            {!settings.contactEmail && !settings.contactPhone && !settings.socialLinks.length && <li><Link className="text-ink hover:text-berry" href="/contact">Contact us</Link></li>}
          </ul>
        </div>
      </Container>
      <div className="border-t border-line">
        <Container className="py-6 text-xs text-ink-muted">
          <p>© {year} {settings.businessName}. All rights reserved.</p>
        </Container>
      </div>
    </footer>
  );
}
