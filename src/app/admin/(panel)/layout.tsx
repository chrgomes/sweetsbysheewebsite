import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BRAND_ASSETS, BRAND_NAME } from "@/lib/brand";
import { logout } from "@/app/admin/actions/auth";
import { AdminNav } from "@/components/admin/nav";
import { requireAdmin } from "@/lib/auth/session";
import { can, ROLE_LABELS, type Permission } from "@/lib/permissions";

export const metadata: Metadata = { title: { default: "Admin", template: "%s | Admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const all: { href: string; label: string; permission: Permission }[] = [
    { href: "/admin", label: "Dashboard", permission: "dashboard:view" },
    { href: "/admin/orders", label: "Orders", permission: "orders:view" },
    { href: "/admin/calendar", label: "Calendar", permission: "calendar:view" },
    { href: "/admin/inquiries", label: "Custom requests", permission: "inquiries:view" },
    { href: "/admin/customers", label: "Customers", permission: "customers:view" },
    { href: "/admin/products", label: "Products", permission: "products:view" },
    { href: "/admin/collections", label: "Collections", permission: "products:edit" },
    { href: "/admin/categories", label: "Categories", permission: "products:view" },
    { href: "/admin/inventory", label: "Inventory", permission: "inventory:view" },
    { href: "/admin/suppliers", label: "Suppliers", permission: "inventory:view" },
    { href: "/admin/discounts", label: "Discount codes", permission: "discounts:manage" },
    { href: "/admin/content", label: "Site content", permission: "content:edit" },
    { href: "/admin/settings", label: "Settings", permission: "settings:edit" },
    { href: "/admin/users", label: "Team", permission: "users:manage" },
    { href: "/admin/audit", label: "Activity log", permission: "audit:view" },
    { href: "/admin/system", label: "System health", permission: "system:view" },
  ];
  // Hiding links is a convenience; every page and action checks its own permission.
  const items = [...all.filter((i) => can(admin.role, i.permission)), { href: "/admin/account", label: "My account" }];
  return (
    <div className="min-h-dvh bg-cream lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-line bg-paper lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 lg:block lg:py-6">
          <Link href="/admin" className="flex items-center gap-2 font-display text-xl text-ink">
            <Image src={BRAND_ASSETS.logo} alt="" width={40} height={40} className="size-10" />
            {BRAND_NAME}
          </Link>
          <Link href="/" className="text-xs text-ink-muted hover:text-berry lg:mt-1 lg:block">View site ↗</Link>
        </div>
        <AdminNav items={items} />
        <div className="hidden border-t border-line px-5 py-4 text-xs text-ink-muted lg:absolute lg:bottom-0 lg:block lg:w-full">
          <p className="truncate">{admin.name}</p>
          <p className="truncate">{admin.email} · {ROLE_LABELS[admin.role]}</p>
          <form action={logout} className="mt-2"><button className="text-berry hover:underline">Sign out</button></form>
        </div>
      </aside>
      <div className="min-w-0 px-4 py-8 sm:px-8 lg:px-12">
        {children}
        <form action={logout} className="mt-12 lg:hidden"><button className="text-sm text-berry hover:underline">Sign out ({admin.email})</button></form>
      </div>
    </div>
  );
}
