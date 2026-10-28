import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@/db";
import { audit, type Actor } from "@/lib/audit";
import { log } from "@/lib/log";
import { deleteFile } from "@/lib/storage";

/** Find or create the customer record for an email, refreshing name/phone to the latest given. */
export async function upsertCustomer(tx: DbOrTx, c: { email: string; name: string; phone?: string | null }): Promise<string> {
  const email = c.email.trim().toLowerCase();
  const [row] = await tx
    .insert(schema.customers)
    .values({ email, name: c.name, phone: c.phone ?? null })
    .onConflictDoUpdate({
      target: schema.customers.email,
      set: { name: c.name, phone: sql`coalesce(${c.phone ?? null}, ${schema.customers.phone})`, updatedAt: new Date() },
    })
    .returning({ id: schema.customers.id });
  return row.id;
}

const ERASED = "Erased customer";

/**
 * Erase a customer's personal data on request. Orders, payments and refunds keep
 * their amounts (needed for accounting) but lose names, contact details,
 * addresses and free-text notes; uploaded photos are deleted.
 */
export async function eraseCustomer(actor: Actor, customerId: string) {
  const customer = await db().query.customers.findFirst({ where: eq(schema.customers.id, customerId) });
  if (!customer) return { ok: false as const, message: "Customer not found." };
  if (customer.erasedAt) return { ok: false as const, message: "Already erased." };
  // Erasing contact details mid-order would leave staff unable to fulfil or refund it.
  const open = await db().query.orders.findFirst({
    where: and(eq(schema.orders.customerId, customerId), inArray(schema.orders.status, ["pending", "confirmed", "in_production", "ready", "on_hold"])),
    columns: { reference: true },
  });
  if (open) return { ok: false as const, message: `Order ${open.reference} is still open. Complete or cancel it before erasing this customer.` };
  const placeholderEmail = `erased-${customer.id}@invalid.example`;

  const keys = await db().transaction(async (tx) => {
    const orderIds = (await tx.query.orders.findMany({ where: eq(schema.orders.customerId, customerId), columns: { id: true } })).map((o) => o.id);
    await tx
      .update(schema.orders)
      .set({ customerName: ERASED, customerEmail: placeholderEmail, customerPhone: null, deliveryAddress: null, notes: null })
      .where(eq(schema.orders.customerId, customerId));
    const inquiries = await tx.query.inquiries.findMany({ where: eq(schema.inquiries.customerId, customerId), columns: { id: true } });
    const ids = inquiries.map((i) => i.id);
    let attachmentKeys: string[] = [];
    if (ids.length) {
      const atts = await tx.query.inquiryAttachments.findMany({ where: inArray(schema.inquiryAttachments.inquiryId, ids) });
      attachmentKeys = atts.map((a) => a.storageKey);
      await tx.delete(schema.inquiryAttachments).where(inArray(schema.inquiryAttachments.inquiryId, ids));
      await tx
        .update(schema.inquiries)
        .set({
          customerName: ERASED,
          customerEmail: placeholderEmail,
          customerPhone: null,
          deliveryAddress: null,
          design: "[erased]",
          theme: null,
          colours: null,
          message: null,
          allergies: null,
          budget: null,
          details: null,
        })
        .where(inArray(schema.inquiries.id, ids));
    }
    // Emails to the customer, and business copies about their orders and requests, both contain personal data.
    const relatedIds = [...orderIds, ...ids];
    await tx
      .update(schema.notifications)
      .set({ text: "[erased]", html: null, subject: "[erased]" })
      .where(
        or(
          eq(schema.notifications.toEmail, customer.email),
          relatedIds.length ? inArray(schema.notifications.relatedId, relatedIds) : undefined,
          eq(schema.notifications.relatedId, customerId),
        ),
      );
    await tx.update(schema.notifications).set({ toEmail: placeholderEmail }).where(eq(schema.notifications.toEmail, customer.email));
    await tx
      .update(schema.customers)
      .set({ email: placeholderEmail, name: ERASED, phone: null, internalNotes: null, erasedAt: new Date() })
      .where(eq(schema.customers.id, customerId));
    return attachmentKeys;
  });
  await Promise.all(keys.map((k) => deleteFile("private", k).catch((e) => log.error("customer.erase_file_failed", { key: k, error: String(e) }))));
  await audit(actor, "customer.erased", "customer", customerId, { attachmentsDeleted: keys.length });
  return { ok: true as const };
}
