/**
 * Set a new password for an existing administrator, e.g. when the owner is
 * locked out. Signs the account out everywhere. Doesn't reactivate a
 * deactivated account or change its role.
 *
 *   ADMIN_EMAIL=owner@example.com pnpm admin:reset-password
 *   pnpm admin:reset-password owner@example.com
 *
 * The password is read from ADMIN_PASSWORD, or prompted for twice (hidden)
 * when run interactively. It is never printed or logged.
 */
import { eq } from "drizzle-orm";
import { hashPassword, passwordProblems } from "../../src/lib/auth/password";
import { closeDb, db, redactedUrl, schema } from "../lib/db";
import { promptHidden } from "../lib/prompt";

async function fail(message: string): Promise<never> {
  console.error(message);
  await closeDb();
  process.exit(1);
}

const email = (process.env.ADMIN_EMAIL ?? process.argv[2] ?? "").trim().toLowerCase();
if (!email || !email.includes("@")) await fail("Usage: pnpm admin:reset-password you@example.com   (or ADMIN_EMAIL=you@example.com)");

const user = await db.query.adminUsers.findFirst({ where: eq(schema.adminUsers.email, email) });
if (!user) {
  const all = await db.query.adminUsers.findMany({ columns: { email: true } });
  await fail(`No admin account with email ${email} in ${redactedUrl()}.${all.length ? ` Accounts: ${all.map((u) => u.email).join(", ")}` : " There are no admin accounts; use pnpm admin:create."}`);
}

let password = process.env.ADMIN_PASSWORD ?? "";
if (!password) {
  if (!process.stdin.isTTY) await fail("Set ADMIN_PASSWORD, or run this in an interactive terminal.");
  password = await promptHidden("New password (min 12 characters): ");
  const problem = passwordProblems(password);
  if (problem) await fail(problem);
  if ((await promptHidden("Repeat the new password: ")) !== password) await fail("The passwords don't match. Nothing was changed.");
}
const problem = passwordProblems(password);
if (problem) await fail(problem);

await db.update(schema.adminUsers).set({ passwordHash: await hashPassword(password) }).where(eq(schema.adminUsers.id, user!.id));
await db.delete(schema.adminSessions).where(eq(schema.adminSessions.userId, user!.id));
await db.insert(schema.auditLog).values({ actorLabel: "cli", action: "admin.password_reset", entityType: "admin_user", entityId: user!.id, details: { email } });
console.log(`Password reset for ${email} in ${redactedUrl()}. Existing sign-ins were ended.`);
if (!user!.active) console.log("Note: this account is deactivated. Reactivate it from Admin → Team using another owner account.");
await closeDb();
