import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit, type Actor } from "@/lib/audit";

/**
 * Permanently remove a team member's account. Their sign-ins end with it;
 * history stays readable because audit entries keep the actor's email and
 * other references are set to null. Refuses to delete the caller's own
 * account or the last active owner. Owner rows are locked so two owners
 * can't delete each other at the same time.
 */
export async function deleteAdminUser(actor: Actor, userId: string) {
  if (userId === actor.id) return { ok: false as const, message: "You can't delete your own account." };
  const res = await db().transaction(async (tx) => {
    const owners = await tx
      .select({ id: schema.adminUsers.id })
      .from(schema.adminUsers)
      .where(and(eq(schema.adminUsers.role, "owner"), eq(schema.adminUsers.active, true)))
      .for("update");
    const user = await tx.query.adminUsers.findFirst({ where: eq(schema.adminUsers.id, userId), columns: { id: true, email: true, role: true, active: true } });
    if (!user) return { ok: false as const, message: "That account no longer exists." };
    if (user.role === "owner" && user.active && owners.length <= 1) return { ok: false as const, message: "There must always be at least one active owner." };
    await tx.delete(schema.adminUsers).where(eq(schema.adminUsers.id, userId));
    return { ok: true as const, email: user.email, role: user.role };
  });
  // After commit: audit() writes on its own connection, which would wait on the locked owner rows.
  if (res.ok) await audit(actor, "admin.user_deleted", "admin_user", userId, { email: res.email, role: res.role });
  return res;
}
