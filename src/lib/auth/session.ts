import "server-only";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { randomToken, sha256 } from "@/lib/tokens";
import type { Actor } from "@/lib/audit";
import { can, type Permission, type Role } from "@/lib/permissions";

export const SESSION_COOKIE = "sbs_admin";
const SESSION_DAYS = 7;

export type AdminRole = Role;
export type AdminUser = { id: string; email: string; name: string; role: AdminRole };

export async function createSession(userId: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await db().insert(schema.adminSessions).values({ id: sha256(token), userId, expiresAt, userAgent: ua });
  // Clean up this user's expired sessions.
  await db()
    .delete(schema.adminSessions)
    .where(and(eq(schema.adminSessions.userId, userId), lt(schema.adminSessions.expiresAt, new Date())));
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db().delete(schema.adminSessions).where(eq(schema.adminSessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/** The signed-in admin, or null. Cached per request. */
export const getAdmin = cache(async (): Promise<AdminUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const row = await db()
    .select({ id: schema.adminUsers.id, email: schema.adminUsers.email, name: schema.adminUsers.name, role: schema.adminUsers.role, active: schema.adminUsers.active })
    .from(schema.adminSessions)
    .innerJoin(schema.adminUsers, eq(schema.adminUsers.id, schema.adminSessions.userId))
    .where(and(eq(schema.adminSessions.id, sha256(token)), gt(schema.adminSessions.expiresAt, new Date())))
    .limit(1);
  const u = row[0];
  if (!u || !u.active) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
});

/**
 * Use at the top of every admin page and Server Action. Redirects to login when
 * signed out, and to the dashboard when the role lacks the permission.
 */
export async function requireAdmin(permission?: Permission): Promise<AdminUser> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  if (permission && !can(admin.role, permission)) redirect("/admin?denied=1");
  return admin;
}

/** For Server Actions that return errors instead of redirecting. */
export async function adminCan(permission: Permission): Promise<AdminUser | null> {
  const admin = await getAdmin();
  return admin && can(admin.role, permission) ? admin : null;
}

export function actorFor(admin: AdminUser): Actor {
  return { id: admin.id, label: admin.email };
}
