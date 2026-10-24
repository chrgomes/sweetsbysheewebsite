import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Container, SectionHeading } from "@/components/ui/container";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch about orders, custom cakes and events.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const s = await getSettings();
  const items: { label: string; value: string; href?: string; external?: boolean }[] = [
    ...(s.contactEmail ? [{ label: "Email", value: s.contactEmail, href: `mailto:${s.contactEmail}` }] : []),
    ...(s.contactPhone ? [{ label: "Phone", value: s.contactPhone, href: `tel:${s.contactPhone.replace(/[^\d+]/g, "")}` }] : []),
    ...(s.showAddress && s.addressLines.length ? [{ label: "Address", value: s.addressLines.join("\n") }] : []),
    ...(s.hours ? [{ label: "Hours", value: s.hours }] : []),
    ...(s.serviceArea ? [{ label: "Service area", value: s.serviceArea }] : []),
    ...s.socialLinks.map((l) => ({ label: l.label, value: l.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), href: l.url, external: true })),
  ];
  return (
    <Container className="py-12 lg:py-20">
      <div className="grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SectionHeading as="h1" eyebrow="Contact" title="We'd love to hear from you" intro="Questions about flavours, sizes or dates? Reach out and we'll get back to you." />
          {s.customOrdersEnabled && (
            <div className="mt-8 rounded-2xl border border-line bg-paper p-6">
              <p className="font-display text-xl text-ink">Planning a celebration?</p>
              <p className="mt-2 text-ink-soft">For custom cakes and event orders, the request form helps us give you an accurate quote quickly.</p>
              <ButtonLink href="/custom-orders" className="mt-4" size="sm">Request a custom order</ButtonLink>
            </div>
          )}
        </div>
        <div className="lg:col-span-6 lg:col-start-7">
          {items.length ? (
            <dl className="divide-y divide-line border-y border-line">
              {items.map((it) => (
                <div key={it.label + it.value} className="grid gap-1 py-6 sm:grid-cols-3">
                  <dt className="text-sm font-medium tracking-wide text-ink-muted uppercase">{it.label}</dt>
                  <dd className="text-lg whitespace-pre-line text-ink sm:col-span-2">
                    {it.href ? (
                      <a href={it.href} className="break-words hover:text-berry" {...(it.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                        {it.value}
                        {it.external && <span className="sr-only"> (opens in a new tab)</span>}
                      </a>
                    ) : (
                      it.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-lg text-ink-soft">Contact details are coming soon.</p>
          )}
        </div>
      </div>
    </Container>
  );
}
