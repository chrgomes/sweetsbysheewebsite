import { env } from "@/lib/env";
import { runJobs } from "@/lib/jobs";
import { safeEqual } from "@/lib/tokens";

export const dynamic = "force-dynamic";

/**
 * Background jobs for hosts with an HTTP scheduler (e.g. a cron that POSTs
 * every 5 minutes with `Authorization: Bearer $CRON_SECRET`). Disabled unless
 * CRON_SECRET is set. Every job is idempotent, so overlapping runs are safe.
 */
export async function POST(req: Request) {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !auth.startsWith("Bearer ") || !safeEqual(auth.slice(7), secret)) {
    return new Response("Not found", { status: 404 });
  }
  const results = await runJobs();
  // Only names of failed jobs leave the server; details are in the logs.
  const failed = Object.entries(results)
    .filter(([, r]) => typeof r === "object" && r !== null && "error" in r)
    .map(([k]) => k);
  return Response.json({ ok: failed.length === 0, failed }, { status: failed.length ? 500 : 200 });
}
