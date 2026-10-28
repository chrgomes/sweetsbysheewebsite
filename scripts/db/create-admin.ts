/**
 * Provision an administrator. There is deliberately no public sign-up.
 *
 *   ADMIN_EMAIL=owner@example.com ADMIN_NAME="Shyee" pnpm admin:create
 *
 * The password is read from ADMIN_PASSWORD, or prompted for (hidden) when
 * run interactively. It is never printed or logged.
 */
import { eq } from "drizzle-orm";
import { hashPassword, passwordProblems } from "../../src/lib/auth/password";
import { ROLES, type Role } from "../../src/lib/permissions";
import { closeDb, db, redactedUrl, schema } from "../lib/db";
import { promptHidden } from "../lib/prompt";

const email = (process.env.ADMIN_EMAIL ?? process.argv[2] ?? "").trim().toLowerCase();
const name = (process.env.ADMIN_NAME ?? process.argv[3] ?? "").trim();
const requested = process.env.ADMIN_ROLE ?? "owner";
if (!ROLES.includes(requested as Role)) {
  console.error(`ADMIN_ROLE must be one of: ${ROLES.join(", ")}`);
  process.exit(1);
}
const role = requested as Role;
if (!email || !email.includes("@") || !name) {
  console.error('Usage: ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" [ADMIN_ROLE=owner|admin|order_manager|production|reporting] pnpm admin:create');
  process.exit(1);
}
const password = process.env.ADMIN_PASSWORD ?? (process.stdin.isTTY ? await promptHidden("Password (min 12 characters): ") : "");
const problem = passwordProblems(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}
const existing = await db.query.adminUsers.findFirst({ where: eq(schema.adminUsers.email, email) });
if (existing) {
  console.error(`An admin with email ${email} already exists. Use pnpm admin:reset-password, or reset it from Admin → Team.`);
  await closeDb();
  process.exit(1);
}
await db.insert(schema.adminUsers).values({ email, name, role, passwordHash: await hashPassword(password) });
await db.insert(schema.auditLog).values({ actorLabel: "cli", action: "admin.user_created", entityType: "admin_user", details: { email, role } });
console.log(`Created ${role} account ${email} in ${redactedUrl()}`);
await closeDb();
