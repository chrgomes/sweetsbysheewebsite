import "server-only";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type DbOrTx, type Tx } from "@/db";
import { audit, type Actor } from "@/lib/audit";
import { addDays, isIsoDate, startOfDayInZone } from "@/lib/dates";
import { discountAmount } from "@/lib/pricing";

/**
 * Discount codes. The amount is computed by the pricing service; this module
 * checks a code's rules and records redemptions. Limits count pending
 * (checkout started) and confirmed (paid) redemptions; abandoned checkouts are
 * voided and free their slot. Reservation locks the discount row, so two
 * customers can't both take a code's last use.
 */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export type DiscountCheck =
  | { ok: true; discount: typeof schema.discounts.$inferSelect; amountCents: number }
  | { ok: false; message: string };

const INVALID = "That code isn't valid.";

async function usedCount(tx: DbOrTx, discountId: string, email?: string) {
  const where = [eq(schema.discountRedemptions.discountId, discountId), ne(schema.discountRedemptions.status, "void")];
  if (email) where.push(eq(schema.discountRedemptions.customerEmail, email.toLowerCase()));
  const [row] = await tx.select({ n: count() }).from(schema.discountRedemptions).where(and(...where));
  return row.n;
}

/** Validate a code for a subtotal (and optionally a customer). Pure read; doesn't reserve. */
export async function checkDiscount(
  rawCode: string,
  subtotalCents: number,
  opts: { email?: string; now?: Date; tx?: DbOrTx; currency?: string } = {},
): Promise<DiscountCheck> {
  const tx = opts.tx ?? db();
  const code = normalizeCode(rawCode);
  if (!code || code.length > 40) return { ok: false, message: INVALID };
  const discount = await tx.query.discounts.findFirst({ where: eq(schema.discounts.code, code) });
  const now = opts.now ?? new Date();
  if (!discount || !discount.active) return { ok: false, message: INVALID };
  if (discount.startsAt && now < discount.startsAt) return { ok: false, message: INVALID };
  if (discount.endsAt && now > discount.endsAt) return { ok: false, message: "That code has expired." };
  if (subtotalCents < discount.minSubtotalCents) {
    const min = new Intl.NumberFormat("en-US", { style: "currency", currency: (opts.currency ?? "usd").toUpperCase() }).format(discount.minSubtotalCents / 100);
    return { ok: false, message: `That code needs an order of at least ${min}.` };
  }
  if (discount.maxRedemptions !== null && (await usedCount(tx, discount.id)) >= discount.maxRedemptions) {
    return { ok: false, message: "That code has been fully redeemed." };
  }
  if (opts.email && discount.maxPerCustomer !== null && (await usedCount(tx, discount.id, opts.email)) >= discount.maxPerCustomer) {
    return { ok: false, message: "You've already used that code." };
  }
  const amountCents = discountAmount(discount, subtotalCents);
  if (amountCents <= 0) return { ok: false, message: INVALID };
  return { ok: true, discount, amountCents };
}

/**
 * Re-check and record a redemption inside the order transaction. The row lock
 * makes the limit check and insert atomic across concurrent checkouts.
 */
export async function reserveDiscount(
  tx: Tx,
  p: { code: string; subtotalCents: number; email: string; orderId: string; currency: string },
): Promise<DiscountCheck> {
  const code = normalizeCode(p.code);
  await tx.select({ id: schema.discounts.id }).from(schema.discounts).where(eq(schema.discounts.code, code)).for("update");
  const check = await checkDiscount(code, p.subtotalCents, { email: p.email, tx, currency: p.currency });
  if (!check.ok) return check;
  await tx.insert(schema.discountRedemptions).values({
    discountId: check.discount.id,
    orderId: p.orderId,
    customerEmail: p.email.toLowerCase(),
    amountCents: check.amountCents,
    status: "pending",
  });
  return check;
}

export async function confirmRedemption(tx: DbOrTx, orderId: string) {
  await tx
    .update(schema.discountRedemptions)
    .set({ status: "confirmed" })
    .where(and(eq(schema.discountRedemptions.orderId, orderId), eq(schema.discountRedemptions.status, "pending")));
}

export async function voidRedemption(tx: DbOrTx, orderId: string) {
  await tx
    .update(schema.discountRedemptions)
    .set({ status: "void" })
    .where(and(eq(schema.discountRedemptions.orderId, orderId), ne(schema.discountRedemptions.status, "void")));
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export const discountInputSchema = z
  .object({
    code: z
      .string()
      .transform(normalizeCode)
      .pipe(z.string().regex(/^[A-Z0-9_-]{3,40}$/, "Use 3–40 letters, numbers, dashes or underscores.")),
    description: z.string().trim().max(200).nullable(),
    kind: z.enum(["percent", "fixed"]),
    /** percent: basis points; fixed: cents. */
    value: z.number().int().positive("Enter the discount amount."),
    minSubtotalCents: z.number().int().min(0),
    startsOn: z.string().refine(isIsoDate).nullable(),
    endsOn: z.string().refine(isIsoDate).nullable(),
    maxRedemptions: z.number().int().positive().nullable(),
    maxPerCustomer: z.number().int().positive().nullable(),
    active: z.boolean(),
  })
  .refine((d) => d.kind !== "percent" || d.value <= 10_000, { path: ["value"], message: "A percentage can't be more than 100%." })
  .refine((d) => !d.startsOn || !d.endsOn || d.startsOn <= d.endsOn, { path: ["endsOn"], message: "The end date is before the start date." });
export type DiscountInput = z.infer<typeof discountInputSchema>;

/** Create or update a code. Dates are whole days in the bakery's timezone. */
export async function saveDiscount(actor: Actor, id: string | null, input: DiscountInput, timeZone: string) {
  const values = {
    code: input.code,
    description: input.description,
    kind: input.kind,
    value: input.value,
    minSubtotalCents: input.minSubtotalCents,
    startsAt: input.startsOn ? startOfDayInZone(input.startsOn, timeZone) : null,
    endsAt: input.endsOn ? new Date(startOfDayInZone(addDays(input.endsOn, 1), timeZone).getTime() - 1) : null,
    maxRedemptions: input.maxRedemptions,
    maxPerCustomer: input.maxPerCustomer,
    active: input.active,
  };
  const clash = await db().query.discounts.findFirst({ where: eq(schema.discounts.code, input.code), columns: { id: true } });
  if (clash && clash.id !== id) return { ok: false as const, message: "There's already a code with that name." };
  if (id) {
    const before = await db().query.discounts.findFirst({ where: eq(schema.discounts.id, id) });
    if (!before) return { ok: false as const, message: "Code not found." };
    await db().update(schema.discounts).set(values).where(eq(schema.discounts.id, id));
    await audit(actor, "discount.updated", "discount", id, { code: input.code, kind: input.kind, value: input.value, active: input.active });
    return { ok: true as const, id };
  }
  const [row] = await db().insert(schema.discounts).values(values).returning({ id: schema.discounts.id });
  await audit(actor, "discount.created", "discount", row.id, { code: input.code, kind: input.kind, value: input.value });
  return { ok: true as const, id: row.id };
}

export async function listDiscounts() {
  const [rows, usage] = await Promise.all([
    db().query.discounts.findMany({ orderBy: [desc(schema.discounts.createdAt)] }),
    db()
      .select({ discountId: schema.discountRedemptions.discountId, status: schema.discountRedemptions.status, n: count(), cents: sql<number>`coalesce(sum(${schema.discountRedemptions.amountCents}), 0)::int` })
      .from(schema.discountRedemptions)
      .groupBy(schema.discountRedemptions.discountId, schema.discountRedemptions.status),
  ]);
  return rows.map((d) => {
    const u = usage.filter((x) => x.discountId === d.id);
    const confirmed = u.find((x) => x.status === "confirmed");
    return { ...d, confirmedUses: confirmed?.n ?? 0, confirmedCents: confirmed?.cents ?? 0, pendingUses: u.find((x) => x.status === "pending")?.n ?? 0 };
  });
}
