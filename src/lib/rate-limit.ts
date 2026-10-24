import "server-only";
import { lt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { hmac } from "@/lib/tokens";

/**
 * Fixed-window rate limiter backed by Postgres so limits hold across
 * multiple server instances. Keys are hashed; raw IPs are never stored.
 */
export async function rateLimit(bucket: string, identifier: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number }> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const key = `${bucket}:${hmac(env().APP_SECRET, identifier).slice(0, 32)}`;
  const [row] = await db()
    .insert(schema.rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [schema.rateLimits.key, schema.rateLimits.windowStart],
      set: { count: sql`${schema.rateLimits.count} + 1` },
    })
    .returning({ count: schema.rateLimits.count });
  // Opportunistic cleanup of old windows.
  if (Math.random() < 0.02) {
    await db().delete(schema.rateLimits).where(lt(schema.rateLimits.windowStart, new Date(Date.now() - 86_400_000)));
  }
  return { allowed: row.count <= limit, remaining: Math.max(0, limit - row.count) };
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  if (env().TRUST_PROXY_HEADERS) {
    const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
    const real = h.get("x-real-ip");
    if (real) return real;
  }
  return "unknown";
}
