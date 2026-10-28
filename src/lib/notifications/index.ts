import "server-only";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import type { SiteSettings } from "@/lib/settings";
import type { RenderedEmail } from "./layout";

export const MAX_ATTEMPTS = 5;

export type Outgoing = {
  kind: string;
  /** Stable key for this message, e.g. `order:<id>:confirmed`. A second enqueue with the same key is ignored. */
  dedupeKey: string;
  to: string;
  email: RenderedEmail;
  replyTo?: string | null;
  related?: { type: string; id: string };
};

/**
 * Add a message to the outbox. Call inside the same transaction as the change
 * that causes it, so the email exists if and only if the change committed.
 * Returns the new id, or null when the key was already used (a retry).
 */
export async function enqueue(tx: DbOrTx, n: Outgoing): Promise<string | null> {
  const [row] = await tx
    .insert(schema.notifications)
    .values({
      kind: n.kind,
      dedupeKey: n.dedupeKey,
      toEmail: n.to,
      subject: n.email.subject,
      text: n.email.text,
      html: n.email.html,
      replyTo: n.replyTo ?? null,
      relatedType: n.related?.type ?? null,
      relatedId: n.related?.id ?? null,
    })
    .onConflictDoNothing({ target: schema.notifications.dedupeKey })
    .returning({ id: schema.notifications.id });
  return row?.id ?? null;
}

/** Where business alerts go: BUSINESS_NOTIFICATION_EMAIL, else the public contact email. */
export function businessRecipient(s: SiteSettings): string | null {
  return env().BUSINESS_NOTIFICATION_EMAIL ?? s.contactEmail ?? null;
}

/** Exponential backoff: 1, 2, 4, 8 … minutes after each failed attempt. */
export function nextAttemptDelayMs(attempts: number): number {
  return 60_000 * 2 ** Math.max(0, attempts - 1);
}

/**
 * Send due messages (optionally only the given ids). Rows are claimed with
 * SKIP LOCKED so concurrent runners never send the same message twice.
 */
export async function deliverDue(opts: { ids?: string[]; limit?: number } = {}): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const claimed = await db().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.status, "pending"),
          lte(schema.notifications.nextAttemptAt, new Date()),
          opts.ids?.length ? inArray(schema.notifications.id, opts.ids) : undefined,
        ),
      )
      .orderBy(asc(schema.notifications.createdAt))
      .limit(opts.limit ?? 25)
      .for("update", { skipLocked: true });
    if (rows.length) {
      // Push the next attempt out while we send, so a crash mid-send is retried later rather than immediately.
      await tx
        .update(schema.notifications)
        .set({ attempts: sql`${schema.notifications.attempts} + 1`, nextAttemptAt: new Date(Date.now() + 5 * 60_000) })
        .where(inArray(schema.notifications.id, rows.map((r) => r.id)));
    }
    return rows;
  });

  for (const n of claimed) {
    const attempts = n.attempts + 1;
    const result = await sendEmail({ to: n.toEmail, subject: n.subject, text: n.text, html: n.html ?? undefined, replyTo: n.replyTo ?? undefined });
    if (result.ok) {
      sent++;
      await db().update(schema.notifications).set({ status: "sent", sentAt: new Date(), providerMessageId: result.id ?? null, lastError: null }).where(eq(schema.notifications.id, n.id));
    } else {
      failed++;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db()
        .update(schema.notifications)
        .set({ status: giveUp ? "failed" : "pending", lastError: result.error.slice(0, 500), nextAttemptAt: new Date(Date.now() + nextAttemptDelayMs(attempts)) })
        .where(eq(schema.notifications.id, n.id));
      if (giveUp) log.error("notification.gave_up", { id: n.id, kind: n.kind, attempts });
    }
  }
  return { sent, failed };
}

/** Best-effort immediate delivery after a commit; the job runner retries anything left pending. */
export async function deliverNow(ids: (string | null | undefined)[]) {
  const real = ids.filter((x): x is string => !!x);
  if (!real.length) return;
  try {
    await deliverDue({ ids: real });
  } catch (err) {
    log.error("notification.deliver_now_failed", { error: String(err) });
  }
}

/** Requeue a failed message (admin "retry" button). */
export async function retryNotification(id: string) {
  await db()
    .update(schema.notifications)
    .set({ status: "pending", attempts: 0, nextAttemptAt: new Date() })
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.status, "failed")));
  await deliverNow([id]);
}
