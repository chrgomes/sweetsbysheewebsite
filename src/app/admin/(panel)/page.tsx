import Link from "next/link";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { FormAlert } from "@/components/ui/field";
import { requireAdmin } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { lowStock } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import { statusLabel } from "@/lib/orders";
import { paymentProvider } from "@/lib/payments";
import { can } from "@/lib/permissions";
import { formatQuantity } from "@/lib/recipe-math";
import { operationsSummary, salesSummary, type RangeKey } from "@/lib/reports";
import { checkoutReadiness, getSettings } from "@/lib/settings";

export const metadata = { title: "Dashboard" };

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
];

function Stat({ label, value, help, href }: { label: string; value: string | number; help?: string; href?: string }) {
  const body = (
    <>
      <p className="text-3xl text-ink tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-ink-soft">{label}</p>
      {help && <p className="mt-2 text-xs text-ink-muted">{help}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-2xl border border-line bg-paper p-5 hover:border-ink">{body}</Link>
  ) : (
    <div className="h-full rounded-2xl border border-line bg-paper p-5">{body}</div>
  );
}

export default async function Dashboard({ searchParams }: PageProps<"/admin">) {
  const admin = await requireAdmin("dashboard:view");
  const sp = await searchParams;
  const settings = await getSettings();
  const range = RANGES.find((r) => r.key === sp.range) ?? RANGES[0];
  const showSales = can(admin.role, "reports:view");
  const [ops, sales, low] = await Promise.all([
    operationsSummary(settings),
    showSales ? salesSummary(range.key, settings) : Promise.resolve(null),
    can(admin.role, "inventory:view") ? lowStock() : Promise.resolve([]),
  ]);
  const readiness = checkoutReadiness(settings, paymentProvider() !== null);
  const cur = settings.currency;

  return (
    <>
      <AdminHeader title={`Hello, ${admin.name.split(" ")[0]}`} description="Here's what needs your attention." />
      {sp.denied && <div className="mb-6"><FormAlert>Your role doesn&apos;t include access to that page.</FormAlert></div>}

      <h2 className="sr-only">Needs attention</h2>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <li><Stat label="New custom requests" value={ops.newInquiries} href="/admin/inquiries?status=new" /></li>
        <li><Stat label="Confirmed, due within 3 days" value={ops.ordersToStart} help="Not yet in production" href="/admin/orders?status=open" /></li>
        <li><Stat label="Quotes awaiting customers" value={ops.quotesOutstanding} help={ops.quotesOutstandingCents ? `${formatMoney(ops.quotesOutstandingCents, cur)} quoted` : undefined} href="/admin/inquiries?status=awaiting_customer" /></li>
        <li><Stat label="Orders with a balance due" value={ops.balancesDue} help={ops.balancesDueCents ? `${formatMoney(ops.balancesDueCents, cur)} outstanding` : undefined} href="/admin/orders?status=balance" /></li>
      </ul>
      {(ops.failedEmails > 0 || ops.pendingRefunds > 0) && (
        <div className="mt-4">
          <FormAlert>
            {ops.failedEmails > 0 && `${ops.failedEmails} email${ops.failedEmails === 1 ? "" : "s"} failed to send. `}
            {ops.pendingRefunds > 0 && `${ops.pendingRefunds} refund${ops.pendingRefunds === 1 ? " is" : "s are"} waiting for the payment provider. `}
            {can(admin.role, "system:view") && <Link href="/admin/system" className="underline">Open system health</Link>}
          </FormAlert>
        </div>
      )}

      {low.length > 0 && (
        <div className="mt-4">
          <FormAlert tone="info">
            Running low: {low.slice(0, 6).map((i) => `${i.name} (${formatQuantity(i.onHand, i.unit)})`).join(", ")}
            {low.length > 6 ? ` and ${low.length - 6} more` : ""}.{" "}
            <Link href="/admin/inventory?show=low" className="underline">Open inventory</Link>
          </FormAlert>
        </div>
      )}

      {sales && (
        <section aria-labelledby="sales-heading" className="mt-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="sales-heading" className="text-xl text-ink">Sales <span className="text-sm text-ink-muted">{formatDate(sales.fromDate)}{sales.fromDate !== sales.toDate ? ` – ${formatDate(sales.toDate)}` : ""}</span></h2>
            <nav aria-label="Date range" className="flex flex-wrap gap-2">
              {RANGES.map((r) => (
                <Link key={r.key} href={`/admin?range=${r.key}`} aria-current={r.key === range.key ? "page" : undefined} className="rounded-full border border-line-strong px-3 py-1 text-sm aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-cream">{r.label}</Link>
              ))}
            </nav>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <li><Stat label="Net received" value={formatMoney(sales.netCents, cur)} help="Payments received minus refunds issued in this period." /></li>
            <li><Stat label="Payments received" value={formatMoney(sales.receivedCents, cur)} help={`${sales.paymentsCount} payment${sales.paymentsCount === 1 ? "" : "s"}, including deposits and balances.`} /></li>
            <li><Stat label="Orders confirmed" value={sales.ordersConfirmed} help="Orders whose first payment arrived in this period." /></li>
            <li><Stat label="Average order value" value={formatMoney(sales.averageOrderCents, cur)} help="Total (incl. tax and delivery) of orders confirmed in this period, ÷ orders." /></li>
          </ul>
          <p className="mt-3 text-xs text-ink-muted">
            Refunded {formatMoney(sales.refundedCents, cur)} · Product sales after discounts {formatMoney(sales.salesCents, cur)} · Discounts {formatMoney(sales.discountCents, cur)} · Tax collected {formatMoney(sales.taxCents, cur)}. Days follow {settings.timezone}. Definitions: docs/reporting.md.
          </p>
        </section>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <Panel title="Next 7 days">
          {ops.upcoming.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing scheduled.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {ops.upcoming.map((o) => (
                <li key={o.id} className="flex justify-between gap-3 py-2">
                  <span>
                    <Link href={`/admin/orders/${o.id}`} className="font-medium hover:text-berry">{o.reference}</Link> · {o.customerName}
                    <span className="block text-xs text-ink-muted">{o.items.map((i) => `${i.quantity}× ${i.productName}`).join(", ")}</span>
                  </span>
                  <span className="text-right text-ink-soft">{formatDate(o.fulfillmentDate)}{o.fulfillmentWindow ? ` ${o.fulfillmentWindow}` : ""}<span className="block text-xs">{statusLabel(o)}</span></span>
                </li>
              ))}
            </ul>
          )}
          {can(admin.role, "calendar:view") && <Link href="/admin/calendar" className="mt-4 inline-block text-sm text-berry hover:underline">Open calendar →</Link>}
        </Panel>
        <div className="space-y-6">
          <Panel title="Online checkout">
            {readiness.ready ? (
              <p className="text-sm text-sage">Checkout is live{env().PAYMENTS_PROVIDER === "fake" ? " using the TEST payment provider — no real payments are taken." : "."}</p>
            ) : (
              <>
                <p className="text-sm text-ink-soft">Customers can browse but can&apos;t pay online yet:</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink">{readiness.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                {can(admin.role, "settings:edit") && <Link href="/admin/settings" className="mt-4 inline-block text-sm text-berry hover:underline">Open settings →</Link>}
              </>
            )}
          </Panel>
          {can(admin.role, "audit:view") && ops.activity.length > 0 && (
            <Panel title="Recent activity">
              <ul className="space-y-2 text-sm">
                {ops.activity.map((a) => (
                  <li key={a.id}>{a.action.replace(/[._]/g, " ")}<span className="block text-xs text-ink-muted">{formatDateTime(a.createdAt)} · {a.actorLabel}</span></li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
