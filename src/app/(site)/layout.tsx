import { SiteFooter } from "@/components/site/footer";
import { SiteHeader, type NavItem } from "@/components/site/header";
import { BRAND_ASSETS } from "@/lib/brand";
import { listPolicyPages } from "@/lib/content";
import { getSettings } from "@/lib/settings";

// Pages read live catalogue and settings from the database on each request.
export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: LayoutProps<"/">) {
  const [settings, policies] = await Promise.all([getSettings(), listPolicyPages()]);
  const nav: NavItem[] = [
    { href: "/shop", label: "Shop" },
    ...(settings.customOrdersEnabled ? [{ href: "/custom-orders", label: "Custom orders" }] : []),
    { href: "/gallery", label: "Gallery" },
    { href: "/about", label: "About" },
    { href: "/faq", label: "FAQ" },
    { href: "/contact", label: "Contact" },
  ];
  return (
    <>
      <SiteHeader businessName={settings.businessName} logo={settings.logoImage ?? BRAND_ASSETS.logo} nav={nav} announcement={settings.announcement} customOrdersEnabled={settings.customOrdersEnabled} />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      <SiteFooter settings={settings} policies={policies} />
    </>
  );
}
