import "server-only";
import { and, asc, eq, gte, inArray, lte, lt, ne, or, sql } from "drizzle-orm";
import { db, schema, type DbOrTx, type Tx } from "@/db";
import { audit, type Actor } from "@/lib/audit";
import { addDays } from "@/lib/dates";
import type { SiteSettings } from "@/lib/settings";

/**
 * Daily production capacity, measured in units (each product says how many
 * units one of it uses). Orders claim units on their fulfilment date:
 *  - "held" while awaiting payment, until `expiresAt`;
 *  - "confirmed" once paid (or confirmed by staff);
 *  - "released" when cancelled or expired.
 *
 * Concurrency: every claim takes a transaction-scoped advisory lock for its
 * date before counting, so simultaneous checkouts for the last units are
 * serialised and only one succeeds.
 */

/** Holds last slightly longer than a hosted checkout session (60 minutes). */
export const HOLD_MINUTES = 65;

export type DayUsage = { date: string; capacity: number | null; confirmed: number; held: number; remaining: number | null; overridden: boolean };

/** Units in use on a date: confirmed claims plus holds that haven't expired. */
async function usage(tx: DbOrTx, date: string, excludeOrderId?: string) {
  const now = new Date().toISOString();
  const [row] = await tx
    .select({
      confirmed: sql<number>`coalesce(sum(${schema.capacityReservations.units}) filter (where ${schema.capacityReservations.status} = 'confirmed'), 0)::int`,
      held: sql<number>`coalesce(sum(${schema.capacityReservations.units}) filter (where ${schema.capacityReservations.status} = 'held' and ${schema.capacityReservations.expiresAt} > ${now}::timestamptz), 0)::int`,
    })
    .from(schema.capacityReservations)
    .where(and(eq(schema.capacityReservations.date, date), excludeOrderId ? ne(schema.capacityReservations.orderId, excludeOrderId) : undefined));
  return row;
}

async function capacityFor(tx: DbOrTx, date: string, s: SiteSettings): Promise<{ capacity: number | null; overridden: boolean }> {
  const override = await tx.query.capacityOverrides.findFirst({ where: eq(schema.capacityOverrides.date, date) });
  if (override) return { capacity: override.capacityUnits, overridden: true };
  return { capacity: s.dailyCapacityUnits, overridden: false };
}

export async function dayUsage(date: string, s: SiteSettings, tx: DbOrTx = db()): Promise<DayUsage> {
  const [{ capacity, overridden }, u] = await Promise.all([capacityFor(tx, date, s), usage(tx, date)]);
  return { date, capacity, overridden, confirmed: u.confirmed, held: u.held, remaining: capacity === null ? null : capacity - u.confirmed - u.held };
}

/** Serialise all capacity changes for one date within the current transaction. */
async function lockDate(tx: Tx, date: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`capacity:${date}`}))`);
}

export type ClaimResult = { ok: true } | { ok: false; reason: string };

/**
 * Claim capacity for an order. Must run inside the order's transaction.
 * `hold: true` creates an expiring hold; otherwise the claim is confirmed.
 * `force` (staff overrides, already-paid orders) skips the limit check.
 */
export async function claimCapacity(
  tx: Tx,
  s: SiteSettings,
  p: { date: string; units: number; orderId: string; hold: boolean; force?: boolean; holdMinutes?: number },
): Promise<ClaimResult> {
  await lockDate(tx, p.date);
  if (!p.force) {
    const { capacity } = await capacityFor(tx, p.date, s);
    if (capacity !== null) {
      const u = await usage(tx, p.date, p.orderId);
      if (u.confirmed + u.held + p.units > capacity) {
        return { ok: false, reason: "We're fully booked on that date. Please choose another day." };
      }
    }
  }
  const values = {
    date: p.date,
    units: p.units,
    orderId: p.orderId,
    status: p.hold ? ("held" as const) : ("confirmed" as const),
    expiresAt: p.hold ? new Date(Date.now() + (p.holdMinutes ?? HOLD_MINUTES) * 60_000) : null,
  };
  await tx
    .insert(schema.capacityReservations)
    .values(values)
    .onConflictDoUpdate({ target: schema.capacityReservations.orderId, set: { ...values, updatedAt: new Date() } });
  return { ok: true };
}

/**
 * Confirm an order's claim once it's paid. A paid order is never turned away:
 * if its hold had expired, the claim is re-made with `force`, and the calendar
 * flags the day if that takes it over capacity.
 */
export async function confirmCapacity(tx: Tx, s: SiteSettings, order: { id: string; fulfillmentDate: string }, units: number) {
  const existing = await tx.query.capacityReservations.findFirst({ where: eq(schema.capacityReservations.orderId, order.id) });
  if (existing?.status === "confirmed") return;
  await claimCapacity(tx, s, { date: order.fulfillmentDate, units: existing?.units ?? units, orderId: order.id, hold: false, force: true });
}

export async function releaseCapacity(tx: DbOrTx, orderId: string) {
  await tx
    .update(schema.capacityReservations)
    .set({ status: "released", expiresAt: null, updatedAt: new Date() })
    .where(and(eq(schema.capacityReservations.orderId, orderId), ne(schema.capacityReservations.status, "released")));
}

/** Job: mark expired holds released. (They already stopped counting when they expired.) */
export async function releaseExpiredHolds(): Promise<number> {
  const rows = await db()
    .update(schema.capacityReservations)
    .set({ status: "released", updatedAt: new Date() })
    .where(and(eq(schema.capacityReservations.status, "held"), lt(schema.capacityReservations.expiresAt, new Date())))
    .returning({ id: schema.capacityReservations.id });
  return rows.length;
}

/** Dates in [from, to] that can't take `units` more (for the date picker and quotes). */
export async function fullDates(from: string, to: string, units: number, s: SiteSettings): Promise<Set<string>> {
  const days = await usageRange(from, to, s);
  return new Set(days.filter((d) => d.capacity !== null && d.confirmed + d.held + units > d.capacity).map((d) => d.date));
}

/** Usage for every date in a range, in two queries. */
export async function usageRange(from: string, to: string, s: SiteSettings): Promise<DayUsage[]> {
  const now = new Date().toISOString();
  const [rows, overrides] = await Promise.all([
    db()
      .select({
        date: schema.capacityReservations.date,
        confirmed: sql<number>`coalesce(sum(${schema.capacityReservations.units}) filter (where ${schema.capacityReservations.status} = 'confirmed'), 0)::int`,
        held: sql<number>`coalesce(sum(${schema.capacityReservations.units}) filter (where ${schema.capacityReservations.status} = 'held' and ${schema.capacityReservations.expiresAt} > ${now}::timestamptz), 0)::int`,
      })
      .from(schema.capacityReservations)
      .where(and(gte(schema.capacityReservations.date, from), lte(schema.capacityReservations.date, to)))
      .groupBy(schema.capacityReservations.date),
    db().query.capacityOverrides.findMany({ where: and(gte(schema.capacityOverrides.date, from), lte(schema.capacityOverrides.date, to)) }),
  ]);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const ov = new Map(overrides.map((o) => [o.date, o.capacityUnits]));
  const out: DayUsage[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = byDate.get(d);
    const capacity = ov.has(d) ? ov.get(d)! : s.dailyCapacityUnits;
    const confirmed = r?.confirmed ?? 0;
    const held = r?.held ?? 0;
    out.push({ date: d, capacity, overridden: ov.has(d), confirmed, held, remaining: capacity === null ? null : capacity - confirmed - held });
  }
  return out;
}

/** Orders with an active claim in a date range, for the production calendar. */
export async function calendarOrders(from: string, to: string) {
  return db().query.orders.findMany({
    where: and(
      gte(schema.orders.fulfillmentDate, from),
      lte(schema.orders.fulfillmentDate, to),
      or(inArray(schema.orders.status, ["confirmed", "in_production", "ready", "completed", "on_hold"]), eq(schema.orders.status, "pending")),
    ),
    with: { items: true, reservation: true },
    orderBy: [asc(schema.orders.fulfillmentDate), asc(schema.orders.fulfillmentWindow), asc(schema.orders.createdAt)],
  });
}

/** Staff override of one day's capacity. Reason required; audited. */
export async function setCapacityOverride(actor: Actor, date: string, capacityUnits: number | null, reason: string) {
  if (!reason.trim()) return { ok: false as const, message: "Give a reason for the change." };
  const before = await db().query.capacityOverrides.findFirst({ where: eq(schema.capacityOverrides.date, date) });
  if (capacityUnits === null) {
    await db().delete(schema.capacityOverrides).where(eq(schema.capacityOverrides.date, date));
  } else {
    await db()
      .insert(schema.capacityOverrides)
      .values({ date, capacityUnits, reason, createdBy: actor.id })
      .onConflictDoUpdate({ target: schema.capacityOverrides.date, set: { capacityUnits, reason, createdBy: actor.id, updatedAt: new Date() } });
  }
  await audit(actor, capacityUnits === null ? "capacity.override_removed" : "capacity.override_set", "capacity", date, {
    from: before?.capacityUnits ?? null,
    to: capacityUnits,
    reason,
  });
  return { ok: true as const };
}
