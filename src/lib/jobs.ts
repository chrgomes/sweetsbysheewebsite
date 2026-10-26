import "server-only";
import { lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { releaseExpiredHolds } from "@/lib/capacity";
import { log } from "@/lib/log";
import { deliverDue } from "@/lib/notifications";
import { reconcilePendingPayments, sendBalanceReminders } from "@/lib/orders";
import { expireQuotes } from "@/lib/quotes";

/**
 * Periodic maintenance. Every task is idempotent and safe to run concurrently,
 * so the schedule only affects how quickly things happen. Run every few
 * minutes via POST /api/cron (host scheduler) or `pnpm jobs:run`.
 */
export async function runJobs() {
  const started = Date.now();
  const results: Record<string, unknown> = {};
  const tasks: [string, () => Promise<unknown>][] = [
    ["payments", reconcilePendingPayments],
    ["holds", releaseExpiredHolds],
    ["quotes", expireQuotes],
    ["balanceReminders", sendBalanceReminders],
    ["notifications", () => deliverDue({ limit: 100 })],
    ["rateLimits", async () => (await db().delete(schema.rateLimits).where(lt(schema.rateLimits.windowStart, new Date(Date.now() - 86_400_000))).returning({ k: schema.rateLimits.key })).length],
  ];
  for (const [name, task] of tasks) {
    try {
      results[name] = await task();
    } catch (err) {
      // One failing task mustn't stop the others; the failure is logged for monitoring.
      results[name] = { error: String(err) };
      log.error("jobs.task_failed", { task: name, error: String(err) });
    }
  }
  log.info("jobs.run", { ms: Date.now() - started, ...results });
  return results;
}
