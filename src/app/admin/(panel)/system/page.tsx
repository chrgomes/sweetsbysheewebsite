import { and, count, desc, eq, lt, sql } from "drizzle-orm";
import Link from "next/link";
import { retryNotificationAction, runJobsAction } from "@/app/admin/actions/system";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminHeader, DefinitionList, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { businessRecipient } from "@/lib/notifications";
import { paymentProvider } from "@/lib/payments";
import { can } from "@/lib/permissions";
import { checkoutReadiness, getSettings } from "@/lib/settings";

export const metadata = { title: "System health" };

export default async function SystemPage() {
  const admin = await requireAdmin("system:view");
  const settings = await getSettings();
  const e = env();
  const [failed, [pendingEmails], pendingRefunds, [stalePayments]] = await Promise.all([
    db().query.notifications.findMany({ where: eq(schema.notifications.status, "failed"), orderBy: [desc(schema.notifications.createdAt)], limit: 50 }),
    db().select({ n: count() }).from(schema.notifications).where(eq(schema.notifications.status, "pending")),
    db().query.refunds.findMany({ where: eq(schema.refunds.status, "pending"), with: { order: { columns: { id: true, reference: true, currency: true } } }, limit: 50 }),
    db().select({ n: count() }).from(schema.payments).where(and(eq(schema.payments.status, "pending"), lt(schema.payments.createdAt, sql`now() - interval '1 hour'`))),
  ]);
  const readiness = checkoutReadiness(settings, paymentProvider() !== null);
  const recipient = businessRecipient(settings);

  return (
    <>
      <AdminHeader title="System health" description="Integrations and background work. Nothing here shows secrets." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Integrations">
          <DefinitionList items={[
            ["Environment", e.APP_ENV],
            ["Payments", e.PAYMENTS_PROVIDER === "fake" ? "TEST provider — no real payments" : e.PAYMENTS_PROVIDER === "stripe" ? "Stripe" : "Not configured"],
            ["Email", e.EMAIL_PROVIDER === "resend" ? "Resend" : `${e.EMAIL_PROVIDER} — emails are not delivered`],
            ["Business notifications to", recipient ?? "Not set (add a contact email in Settings)"],
            ["Scheduled jobs endpoint", e.CRON_SECRET ? "Enabled (POST /api/cron)" : "Disabled — set CRON_SECRET or run pnpm jobs:run on a schedule"],
            ["Online checkout", readiness.ready ? "Live" : `Off: ${readiness.reasons.join("; ")}`],
          ]} />
        </Panel>
        <Panel title="Background jobs">
          <p className="text-sm text-ink-soft">
            Jobs recover missed payment confirmations, release expired date holds, expire old quotes, send balance reminders and retry emails. They should run every 5–10 minutes. You can also run them now.
          </p>
          <DefinitionList items={[
            ["Emails waiting to send", String(pendingEmails.n)],
            ["Checkouts unconfirmed for over an hour", String(stalePayments.n)],
          ]} />
          <div className="mt-4">
            <AdminForm action={runJobsAction} submitLabel="Run jobs now" variant="secondary"><span /></AdminForm>
          </div>
        </Panel>
      </div>

      <Panel title={`Failed emails (${failed.length})`} className="mt-6">
        {failed.length === 0 ? (
          <p className="text-sm text-ink-soft">None.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {failed.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  {n.subject}
                  <span className="block text-xs text-ink-muted">To {n.toEmail} · {n.attempts} attempts · {formatDateTime(n.createdAt)} · {n.lastError}</span>
                  {n.relatedType && n.relatedId && (n.relatedType === "order" || n.relatedType === "inquiry") && (
                    <Link href={`/admin/${n.relatedType === "order" ? "orders" : "inquiries"}/${n.relatedId}`} className="text-xs text-berry hover:underline">Open {n.relatedType}</Link>
                  )}
                </span>
                {can(admin.role, "orders:manage") && (
                  <AdminForm action={retryNotificationAction} submitLabel="Retry" variant="secondary" className="flex items-center gap-2">
                    <input type="hidden" name="notificationId" value={n.id} />
                  </AdminForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Refunds waiting for the provider (${pendingRefunds.length})`} className="mt-6">
        {pendingRefunds.length === 0 ? (
          <p className="text-sm text-ink-soft">None.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {pendingRefunds.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-3 py-2">
                <Link href={`/admin/orders/${r.order.id}`} className="hover:text-berry">{r.order.reference}</Link>
                <span>{formatMoney(r.amountCents, r.order.currency)} · requested {formatDateTime(r.createdAt)} <Badge tone="honey">pending</Badge></span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
