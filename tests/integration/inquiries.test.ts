import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { eraseCustomer } from "@/lib/customers";
import { failNextEmails } from "@/lib/email";
import { createInquiry, getInquiryForCustomer, inquirySchema, updateInquiry, type InquiryInput } from "@/lib/inquiries";
import { linkToken } from "@/lib/links";
import { handlePaymentEvent, recordOfflinePayment, updateOrderStatus } from "@/lib/orders";
import { acceptQuote, declineQuote, expireQuotes, saveDraftQuote, sendQuote, withdrawQuote, type QuoteDraftInput } from "@/lib/quotes";
import { configureShop, createAdmin, futureDate, resetDb, sentTo } from "../support/db";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48]);

function input(overrides: Record<string, unknown> = {}): InquiryInput {
  return inquirySchema.parse({
    customerName: "Riley",
    customerEmail: "Riley@Example.test ",
    eventDate: futureDate(30),
    eventType: "Birthday",
    productType: "Celebration cake",
    servings: "24",
    design: "Two tiers, pressed flowers",
    fulfillmentMethod: "pickup",
    acknowledge: true,
    ...overrides,
  });
}

function draft(overrides: Partial<QuoteDraftInput> = {}): QuoteDraftInput {
  return {
    fulfillmentMethod: "pickup",
    fulfillmentDate: futureDate(30),
    lines: [
      { description: "Two-tier celebration cake", quantity: 1, unitPriceCents: 22000 },
      { description: "Fresh flowers", quantity: 1, unitPriceCents: 3000 },
    ],
    deliveryFeeCents: 0,
    depositCents: null,
    capacityUnits: 3,
    customerMessage: "Vanilla and raspberry, as discussed.",
    ...overrides,
  };
}

async function newRequest() {
  const res = await createInquiry(input(), []);
  if (!res.ok) throw new Error(res.message);
  return res;
}

beforeEach(async () => {
  await resetDb();
  await configureShop({ depositPercentBps: 5000 });
});

describe("inquiry validation", () => {
  it("requires the core fields and the acknowledgement", () => {
    const r = inquirySchema.safeParse({ customerName: "", customerEmail: "bad", eventDate: "2026-13-01", fulfillmentMethod: "pickup" });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["customerName", "customerEmail", "eventDate", "eventType", "productType", "design", "acknowledge"]));
  });
  it("requires an address for delivery and a phone for phone contact", () => {
    expect(() => input({ fulfillmentMethod: "delivery" })).toThrow();
    expect(() => input({ preferredContact: "phone" })).toThrow();
    expect(input({ preferredContact: "phone", customerPhone: "555 010 0100" }).preferredContact).toBe("phone");
  });
});

describe("createInquiry", () => {
  it("persists the request, links a customer, stores files privately, and emails both parties", async () => {
    const res = await createInquiry(input(), [{ name: "idea.png", kind: { mime: "image/png", ext: "png" }, bytes: PNG }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await db().query.inquiries.findFirst({ where: eq(schema.inquiries.id, res.id), with: { attachments: true, customer: true } });
    expect(row).toMatchObject({ status: "new", servings: 24, customerEmail: "riley@example.test" });
    expect(row!.customer?.email).toBe("riley@example.test");
    const stored = path.join(process.env.STORAGE_DIR!, "private", row!.attachments[0].storageKey);
    expect(existsSync(stored)).toBe(true);
    expect((await sentTo("riley@example.test"))[0].text).toMatch(/not a confirmed order/);
    expect(await sentTo("owner@example.test")).toHaveLength(1);
    expect(await getInquiryForCustomer(res.reference, res.token)).not.toBeNull();
    expect(await getInquiryForCustomer(res.reference, "nope")).toBeNull();
  });

  it("rejects dates inside the minimum notice period", async () => {
    expect(await createInquiry(input({ eventDate: futureDate(2) }), [])).toMatchObject({ ok: false, fieldErrors: { eventDate: expect.stringMatching(/notice/) } });
  });

  it("still saves the request when email fails, and keeps the message queued for retry", async () => {
    failNextEmails(2);
    const res = await createInquiry(input(), []);
    expect(res.ok).toBe(true);
    const queued = await db().query.notifications.findMany();
    expect(queued.map((n) => [n.status, n.attempts, !!n.lastError])).toEqual([
      ["pending", 1, true],
      ["pending", 1, true],
    ]);
  });

  it("only allows review statuses to be set by hand", async () => {
    const res = await newRequest();
    const actor = await createAdmin();
    expect(await updateInquiry(actor, res.id, { status: "reviewing" })).toMatchObject({ ok: true });
    expect(await updateInquiry(actor, res.id, { status: "confirmed" })).toMatchObject({ ok: false });
  });
});

describe("quotes", () => {
  it("prepares, sends, and lets the customer accept; deposit then balance confirm and complete the order", async () => {
    const req = await newRequest();
    const actor = await createAdmin("order_manager");
    const saved = await saveDraftQuote(actor, req.id, draft());
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    let quote = (await db().query.quotes.findFirst({ where: eq(schema.quotes.id, saved.quoteId) }))!;
    // 25,000 + 8% tax = 27,000; default deposit 50% = 13,500.
    expect(quote).toMatchObject({ status: "draft", version: 1, subtotalCents: 25000, taxCents: 2000, totalCents: 27000, depositCents: 13500 });
    expect((await db().query.inquiries.findFirst())!.status).toBe("quote_prepared");

    expect(await sendQuote(actor, quote.id)).toMatchObject({ ok: true });
    quote = (await db().query.quotes.findFirst({ where: eq(schema.quotes.id, saved.quoteId) }))!;
    expect(quote.status).toBe("sent");
    expect(quote.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect((await sentTo("riley@example.test")).some((m) => /quote/.test(m.subject))).toBe(true);
    expect((await db().query.inquiries.findFirst())!.status).toBe("awaiting_customer");

    expect(await acceptQuote(quote.reference, "bad-token")).toMatchObject({ ok: false });
    const accepted = await acceptQuote(quote.reference, linkToken("quote", quote.id));
    expect(accepted).toMatchObject({ ok: true, redirectUrl: expect.stringMatching(/fake-checkout/) });
    // Accepting twice returns the same order rather than creating another.
    const again = await acceptQuote(quote.reference, linkToken("quote", quote.id));
    expect(again.ok).toBe(true);
    expect(await db().query.orders.findMany()).toHaveLength(1);

    let order = (await db().query.orders.findFirst({ with: { reservation: true, items: true } }))!;
    expect(order).toMatchObject({ status: "pending", depositCents: 13500, totalCents: 27000, sourceQuoteId: quote.id });
    expect(order.items.map((i) => i.productName)).toEqual(["Two-tier celebration cake", "Fresh flowers"]);
    expect(order.reservation).toMatchObject({ status: "held", units: 3 });
    expect((await db().query.inquiries.findFirst())!.status).toBe("deposit_required");

    const deposit = (await db().query.payments.findFirst({ where: eq(schema.payments.orderId, order.id) }))!;
    expect(deposit).toMatchObject({ kind: "deposit", amountCents: 13500 });
    await handlePaymentEvent({ id: "evt_dep", provider: "fake", type: "paid", sessionId: deposit.providerSessionId, paymentIntentId: "pi_dep", amountTotalCents: 13500, currency: "usd" });
    order = (await db().query.orders.findFirst({ with: { reservation: true, items: true } }))!;
    expect(order).toMatchObject({ status: "confirmed", paymentStatus: "deposit_paid", amountPaidCents: 13500 });
    expect(order.reservation?.status).toBe("confirmed");
    expect((await db().query.inquiries.findFirst())!.status).toBe("confirmed");

    const owner = await createAdmin();
    await updateOrderStatus(owner, order.id, "in_production");
    await updateOrderStatus(owner, order.id, "ready");
    expect(await updateOrderStatus(owner, order.id, "completed")).toMatchObject({ ok: false, message: expect.stringMatching(/balance/) });
    await recordOfflinePayment(owner, order.id, { amountCents: 13500, method: "card at pickup", note: "Balance paid in person" });
    expect(await updateOrderStatus(owner, order.id, "completed")).toMatchObject({ ok: true });
    expect((await db().query.orders.findFirst())!.paymentStatus).toBe("paid");
    expect((await db().query.inquiries.findFirst())!.status).toBe("completed");
  });

  it("only drafts are editable; a new version withdraws the previous sent quote", async () => {
    const req = await newRequest();
    const actor = await createAdmin();
    const v1 = await saveDraftQuote(actor, req.id, draft());
    if (!v1.ok) throw new Error();
    await sendQuote(actor, v1.quoteId);
    const v2 = await saveDraftQuote(actor, req.id, draft({ lines: [{ description: "Smaller cake", quantity: 1, unitPriceCents: 15000 }] }));
    if (!v2.ok) throw new Error();
    expect(v2.quoteId).not.toBe(v1.quoteId);
    await sendQuote(actor, v2.quoteId);
    const quotes = await db().query.quotes.findMany({ orderBy: (q, o) => [o.asc(q.version)] });
    expect(quotes.map((q) => [q.version, q.status])).toEqual([
      [1, "withdrawn"],
      [2, "sent"],
    ]);
    expect(await acceptQuote(quotes[0].reference, linkToken("quote", quotes[0].id))).toMatchObject({ ok: false });
    expect(await withdrawQuote(actor, quotes[1].id)).toMatchObject({ ok: true });
    expect((await db().query.inquiries.findFirst())!.status).toBe("reviewing");
  });

  it("declines with a reason and tells the business", async () => {
    const req = await newRequest();
    const actor = await createAdmin();
    const q = await saveDraftQuote(actor, req.id, draft());
    if (!q.ok) throw new Error();
    await sendQuote(actor, q.quoteId);
    const quote = (await db().query.quotes.findFirst())!;
    expect(await declineQuote(quote.reference, linkToken("quote", quote.id), "Found another baker")).toMatchObject({ ok: true });
    expect((await db().query.inquiries.findFirst())!.status).toBe("declined");
    expect((await sentTo("owner@example.test")).some((m) => /declined/.test(m.subject))).toBe(true);
  });

  it("expires quotes past their validity and stops acceptance", async () => {
    const req = await newRequest();
    const actor = await createAdmin();
    const q = await saveDraftQuote(actor, req.id, draft());
    if (!q.ok) throw new Error();
    await sendQuote(actor, q.quoteId);
    await db().update(schema.quotes).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await expireQuotes()).toBe(1);
    const quote = (await db().query.quotes.findFirst())!;
    expect(quote.status).toBe("expired");
    expect((await db().query.inquiries.findFirst())!.status).toBe("expired");
    expect(await acceptQuote(quote.reference, linkToken("quote", quote.id))).toMatchObject({ ok: false });
    expect((await sentTo("riley@example.test")).some((m) => /expired/.test(m.subject))).toBe(true);
  });

  it("refuses acceptance when the date has filled up, and warns staff when sending", async () => {
    await configureShop({ dailyCapacityUnits: 2, depositPercentBps: 5000 });
    const req = await newRequest();
    const actor = await createAdmin();
    const q = await saveDraftQuote(actor, req.id, draft({ capacityUnits: 3 }));
    if (!q.ok) throw new Error();
    expect(await sendQuote(actor, q.quoteId)).toMatchObject({ ok: false, capacityWarning: true });
    expect(await sendQuote(actor, q.quoteId, { force: true })).toMatchObject({ ok: true });
    const quote = (await db().query.quotes.findFirst())!;
    const res = await acceptQuote(quote.reference, linkToken("quote", quote.id));
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/filled up/) });
    expect(await db().query.orders.findMany()).toHaveLength(0);
    expect((await db().query.quotes.findFirst())!.status).toBe("sent");
    expect((await db().query.inquiries.findFirst())!.status).toBe("reviewing");
  });
});

describe("customer data erasure", () => {
  it("removes personal data and files but keeps financial records", async () => {
    const res = await createInquiry(input(), [{ name: "idea.png", kind: { mime: "image/png", ext: "png" }, bytes: PNG }]);
    if (!res.ok) throw new Error();
    const att = (await db().query.inquiryAttachments.findFirst())!;
    const customer = (await db().query.customers.findFirst())!;
    const actor = await createAdmin();
    expect(await eraseCustomer(actor, customer.id)).toMatchObject({ ok: true });
    const inquiry = (await db().query.inquiries.findFirst())!;
    expect(inquiry).toMatchObject({ customerName: "Erased customer", customerPhone: null, design: "[erased]" });
    expect(inquiry.customerEmail).toMatch(/@invalid\.example$/);
    expect(await db().query.inquiryAttachments.findMany()).toHaveLength(0);
    expect(existsSync(path.join(process.env.STORAGE_DIR!, "private", att.storageKey))).toBe(false);
    const notes = await db().query.notifications.findMany();
    expect(notes.every((n) => n.toEmail !== "riley@example.test" && !n.text.includes("Riley"))).toBe(true);
    expect(await eraseCustomer(actor, customer.id)).toMatchObject({ ok: false });
  });

  it("refuses while the customer still has an open order", async () => {
    const req = await newRequest();
    const actor = await createAdmin();
    const saved = await saveDraftQuote(actor, req.id, draft());
    if (!saved.ok) throw new Error(saved.message);
    expect(await sendQuote(actor, saved.quoteId)).toMatchObject({ ok: true });
    const quote = (await db().query.quotes.findFirst())!;
    expect(await acceptQuote(quote.reference, linkToken("quote", quote.id))).toMatchObject({ ok: true });
    const customer = (await db().query.customers.findFirst())!;
    expect(await eraseCustomer(actor, customer.id)).toMatchObject({ ok: false, message: expect.stringMatching(/still open/) });
    expect((await db().query.customers.findFirst())!.erasedAt).toBeNull();
  });
});
