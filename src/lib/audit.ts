import "server-only";
import { db, schema } from "@/db";
import { log } from "@/lib/log";

export type Actor = { id: string | null; label: string };

export const SYSTEM_ACTOR: Actor = { id: null, label: "system" };

export async function audit(actor: Actor, action: string, entityType: string, entityId: string | null, details?: Record<string, unknown>) {
  try {
    await db().insert(schema.auditLog).values({ actorId: actor.id, actorLabel: actor.label, action, entityType, entityId, details });
  } catch (err) {
    // Auditing must never break the operation it records.
    log.error("audit.failed", { action, entityType, entityId, error: String(err) });
  }
}
