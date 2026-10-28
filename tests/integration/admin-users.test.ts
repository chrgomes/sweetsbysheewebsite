import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { deleteAdminUser } from "@/lib/admin-users";
import { audit } from "@/lib/audit";
import { createAdmin, resetDb } from "../support/db";

beforeEach(resetDb);

describe("deleting team members", () => {
  it("removes the account and its sessions but keeps its history", async () => {
    const owner = await createAdmin("owner");
    const staff = await createAdmin("production");
    await db().insert(schema.adminSessions).values({ id: "session-hash", userId: staff.id, expiresAt: new Date(Date.now() + 60_000) });
    await audit(staff, "order.status_changed", "order", null);

    expect(await deleteAdminUser(owner, staff.id)).toMatchObject({ ok: true, email: staff.label });
    expect(await db().query.adminUsers.findFirst({ where: eq(schema.adminUsers.id, staff.id) })).toBeUndefined();
    expect(await db().query.adminSessions.findMany()).toHaveLength(0);
    const history = await db().query.auditLog.findFirst({ where: eq(schema.auditLog.action, "order.status_changed") });
    expect(history).toMatchObject({ actorId: null, actorLabel: staff.label });
    expect(await db().query.auditLog.findFirst({ where: eq(schema.auditLog.action, "admin.user_deleted") })).toMatchObject({ actorLabel: owner.label, details: { email: staff.label, role: "production" } });
  });

  it("refuses to delete yourself or the last active owner", async () => {
    const owner = await createAdmin("owner");
    expect(await deleteAdminUser(owner, owner.id)).toMatchObject({ ok: false, message: expect.stringMatching(/your own/) });
    const other = await createAdmin("owner");
    await db().update(schema.adminUsers).set({ active: false }).where(eq(schema.adminUsers.id, owner.id));
    // `other` is now the only active owner; a deactivated owner can't remove it.
    expect(await deleteAdminUser(owner, other.id)).toMatchObject({ ok: false, message: expect.stringMatching(/at least one active owner/) });
    // But an active owner can remove a deactivated one.
    expect(await deleteAdminUser(other, owner.id)).toMatchObject({ ok: true });
  });

  it("never leaves zero owners when two owners delete each other at once", async () => {
    const a = await createAdmin("owner");
    const b = await createAdmin("owner");
    const results = await Promise.all([deleteAdminUser(a, b.id), deleteAdminUser(b, a.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db().query.adminUsers.findMany()).toHaveLength(1);
  });
});
