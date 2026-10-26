import { sql } from "drizzle-orm";
import { db } from "@/db";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Liveness/readiness for uptime monitors and load balancers. Reveals nothing about configuration. */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    log.error("health.db_failed", { error: String(err) });
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
