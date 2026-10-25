import Image from "next/image";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { CartLink, MobileNav, NavLink } from "./header-client";

export type NavItem = { href: string; label: string };

export function SiteHeader({ businessName, logo, nav, announcement, customOrdersEnabled }: { businessName: string; logo: string; nav: NavItem[]; announcement: string | null; customOrdersEnabled: boolean }) {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      {announcement && (
        <div className="bg-ink text-center text-sm text-cream">
          <Container className="py-2.5">
            <p>{announcement}</p>
          </Container>
        </div>
      )}
      <header className="sticky top-0 z-40 border-b border-line/70 bg-cream/90 backdrop-blur supports-[backdrop-filter]:bg-cream/75">
        <Container className="flex h-16 items-center justify-between gap-6 lg:h-20">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label={`${businessName} — home`}>
            <Image src={logo} alt="" width={64} height={64} priority className="size-11 lg:size-14" />
            <span className="font-display text-xl tracking-tight text-ink lg:text-[1.6rem]">{businessName}</span>
          </Link>
          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {nav.map((item) => (
                <li key={item.href}>
                  <NavLink href={item.href}>{item.label}</NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-2">
            {customOrdersEnabled && (
              <Link href="/custom-orders" className="hidden min-h-10 items-center rounded-full bg-berry px-5 text-sm font-medium text-white transition-colors hover:bg-berry-deep sm:inline-flex">
                Request a custom order
              </Link>
            )}
            <CartLink />
            <MobileNav nav={nav} customOrdersEnabled={customOrdersEnabled} />
          </div>
        </Container>
      </header>
    </>
  );
}
