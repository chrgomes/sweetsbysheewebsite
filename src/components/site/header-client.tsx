"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { useCartCount } from "@/components/shop/cart-store";
import type { NavItem } from "./header";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const active = isActive(usePathname(), href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("rounded-full px-4 py-2 text-[0.95rem] transition-colors hover:bg-blush/70", active ? "text-berry" : "text-ink")}
    >
      {children}
    </Link>
  );
}

export function CartLink() {
  const count = useCartCount();
  return (
    <Link href="/cart" className="relative inline-flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-blush/70" aria-label={count ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart, empty"}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M5 8h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 8Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </svg>
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-berry px-1 text-[0.7rem] font-semibold text-white" aria-hidden="true">
          {count}
        </span>
      )}
    </Link>
  );
}

export function MobileNav({ nav, customOrdersEnabled }: { nav: NavItem[]; customOrdersEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close when navigating.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
      if (e.key === "Tab" && panel) {
        const items = [...panel.querySelectorAll<HTMLElement>("a,button")];
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-blush/70"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.6">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <div ref={panelRef} id="mobile-menu" role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-x-0 top-16 bottom-0 z-50 overflow-y-auto bg-cream px-4 pt-6 pb-10">
          <nav aria-label="Mobile">
            <ul className="divide-y divide-line border-y border-line">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined} className="flex min-h-14 items-center font-display text-2xl text-ink aria-[current=page]:text-berry">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {customOrdersEnabled && (
            <Link href="/custom-orders" className="mt-8 flex min-h-13 items-center justify-center rounded-full bg-berry text-base font-medium text-white">
              Request a custom order
            </Link>
          )}
          <Link href="/cart" className="mt-3 flex min-h-13 items-center justify-center rounded-full border border-line-strong text-base text-ink">
            View cart
          </Link>
        </div>
      )}
    </div>
  );
}
