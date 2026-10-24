"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getAdmin } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validation";

export type LoginState = { message?: string; email?: string };

// Verify against a real hash even for unknown emails so response time doesn't reveal which accounts exist.
let dummyHash: Promise<string> | undefined;

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const ip = await clientIp();
  const email = emailSchema.safeParse(form.get("email"));
  const password = String(form.get("password") ?? "");
  const ipLimit = await rateLimit("login-ip", ip, 20, 900);
  const acctLimit = await rateLimit("login-account", email.success ? email.data : "invalid", 8, 900);
  const typed = String(form.get("email") ?? "").slice(0, 254);
  if (!ipLimit.allowed || !acctLimit.allowed) return { message: "Too many sign-in attempts. Please wait 15 minutes and try again.", email: typed };
  if (!email.success || !password) return { message: "Enter your email and password.", email: typed };

  const user = await db().query.adminUsers.findFirst({ where: eq(schema.adminUsers.email, email.data) });
  dummyHash ??= hashPassword("dummy-password-for-timing");
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok || !user.active) {
    await audit({ id: user?.id ?? null, label: email.data }, "admin.login_failed", "admin_user", user?.id ?? null);
    return { message: "That email and password don't match an active account.", email: typed };
  }
  await createSession(user.id);
  await db().update(schema.adminUsers).set({ lastLoginAt: new Date() }).where(eq(schema.adminUsers.id, user.id));
  await audit({ id: user.id, label: user.email }, "admin.login", "admin_user", user.id);
  redirect("/admin");
}

export async function logout() {
  const admin = await getAdmin();
  await destroySession();
  if (admin) await audit({ id: admin.id, label: admin.email }, "admin.logout", "admin_user", admin.id);
  redirect("/admin/login");
}
