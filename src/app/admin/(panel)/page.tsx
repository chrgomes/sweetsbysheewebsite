import { count, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { FormAlert } from "@/components/ui/field";
import { requireAdmin } from "@/lib/auth/session";
import { paymentProvider } from "@/lib/payments";
import { checkoutReadiness, getSettings } from "@/lib/settings";
import { env } from "@/lib/env";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: PageProps<"/admin">) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const settings = await getSettings();
  const readiness = checkoutReadiness(settings, paymentProvider() !== null);
  const q = async (p: Promise<{ value: number }[]>) => (await p)[0]?.value ?? 0;
  const [newInquiries, toFulfil, review, products] = await Promise.all([
    q(db().select({ value: count() }).from(schema.inquiries).where(eq(schema.inquiries.status, "new"))),
    q(db().select({ value: count() }).from(schema.orders).where(inArray(schema.orders.status, ["paid", "in_progress", "ready"]))),
    q(db().select({ value: count() }).from(schema.products).where(eq(schema.products.migrationStatus, "needs_review"))),
    q(db().select({ value: count() }).from(schema.products)),
  ]);
  const stats = [
    { label: "New custom requests", value: newInquiries, href: "/admin/inquiries?status=new" },
    { label: "Orders to fulfil", value: toFulfil, href: "/admin/orders?status=open" },
    { label: "Products needing review", value: review, href: "/admin/products?review=1" },
    { label: "Products", value: products, href: "/admin/products" },
  ];
  return (
    <>
      <AdminHeader title={`Hello, ${admin.name.split(" ")[0]}`} description="Here's what needs your attention." />
      {sp.denied && <div className="mb-6"><FormAlert>That page is only available to the owner account.</FormAlert></div>}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <li key={s.label}>
            <Link href={s.href} className="block rounded-2xl border border-line bg-paper p-5 hover:border-ink">
              <p className="text-3xl text-ink tabular-nums">{s.value}</p>
              <p className="mt-1 text-sm text-ink-soft">{s.label}</p>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel title="Online checkout">
          {readiness.ready ? (
            <p className="text-sm text-sage">Checkout is live{env().PAYMENTS_PROVIDER === "fake" ? " using the TEST payment provider — no real payments are taken." : "."}</p>
          ) : (
            <>
              <p className="text-sm text-ink-soft">Customers can browse but can&apos;t pay online yet:</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink">{readiness.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              {admin.role === "owner" && <Link href="/admin/settings" className="mt-4 inline-block text-sm text-berry hover:underline">Open settings →</Link>}
            </>
          )}
        </Panel>
        <Panel title="Email">
          <p className="text-sm text-ink-soft">
            {env().EMAIL_PROVIDER === "resend"
              ? "Transactional email is configured."
              : "Emails are not being delivered yet (EMAIL_PROVIDER is not set to a real provider). Requests and orders are still saved here."}
          </p>
          <p className="mt-2 text-sm text-ink-soft">Business notifications go to: <strong>{env().BUSINESS_NOTIFICATION_EMAIL ?? settings.contactEmail ?? "not set"}</strong></p>
        </Panel>
      </div>
    </>
  );
}
