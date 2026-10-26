import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { db, schema } from "@/db";
import { dayUsage, releaseExpiredHolds, setCapacityOverride, usageRange } from "@/lib/capacity";
import { addDays } from "@/lib/dates";
import { csvCell } from "@/lib/admin/order-search";
import { checkDiscount, discountInputSchema, listDiscounts, saveDiscount } from "@/lib/discounts";
import { failNextEmails } from "@/lib/email";
import { runJobs } from "@/lib/jobs";
import { deliverDue, enqueue, MAX_ATTEMPTS } from "@/lib/notifications";
import { renderEmail } from "@/lib/notifications/layout";
import { checkoutSchema, earliestDateFor, handlePaymentEvent, placeOrder } from "@/lib/orders";
import { listBestsellers, listNewArrivals } from "@/lib/catalog";
import { salesSummary } from "@/lib/reports";
import { configureShop, createAdmin, createTestProduct, futureDate, resetDb, sentTo } from "../support/db";

function checkout(productId: string, valueId: string, overrides: Partial<z.input<typeof checkoutSchema>> = {}) {
  return checkoutSchema.parse({
    cart: [{ productId, optionValueIds: [valueId], quantity: 1 }],
    customerName: "Sam",
    customerEmail: `sam-${Math.random().toString(36).slice(2, 7)}@example.test`,
    fulfillmentMethod: "pickup",
    fulfillmentDate: futureDate(6),
    ...overrides,
  });
}

beforeEach(resetDb);

describe("production capacity", () => {
  it("lets exactly one of several simultaneous checkouts take the last unit", async () => {
    const s = await configureShop({ dailyCapacityUnits: 3 });
    const { product, values } = await createTestProduct();
    const date = futureDate(6);
    const first = await placeOrder(checkout(product.id, values.small.id, { fulfillmentDate: date, cart: [{ productId: product.id, optionValueIds: [values.small.id], quantity: 2 }] }));
    expect(first.ok).toBe(true);
    const racers = await Promise.all(Array.from({ length: 6 }, () => placeOrder(checkout(product.id, values.small.id, { fulfillmentDate: date }))));
    expect(racers.filter((r) => r.ok)).toHaveLength(1);
    expect(racers.filter((r) => !r.ok).every((r) => !r.ok && /fully booked/.test(r.message))).toBe(true);
    const u = await dayUsage(date, s);
    expect(u).toMatchObject({ capacity: 3, held: 3, remaining: 0 });
  });

  it("frees held capacity when holds expire, and confirms a late payment anyway", async () => {
    const s = await configureShop({ dailyCapacityUnits: 1 });
    const { product, values } = await createTestProduct();
    const date = futureDate(6);
    const a = await placeOrder(checkout(product.id, values.small.id, { fulfillmentDate: date }));
    if (!a.ok) throw new Error(a.message);
    expect((await placeOrder(checkout(product.id, values.small.id, { fulfillmentDate: date }))).ok).toBe(false);
    await db().update(schema.capacityReservations).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await dayUsage(date, s)).remaining).toBe(1);
    expect(await releaseExpiredHolds()).toBe(1);
    const b = await placeOrder(checkout(product.id, values.small.id, { fulfillmentDate: date }));
    expect(b.ok).toBe(true);
    // The first customer pays after their hold lapsed: they're still confirmed, and the day shows as over capacity.
    const pay = (await db().query.payments.findFirst({ where: eq(schema.payments.orderId, a.orderId) }))!;
    expect(await handlePaymentEvent({ id: "late", provider: "fake", type: "paid", sessionId: pay.providerSessionId, paymentIntentId: "pi", amountTotalCents: pay.amountCents, currency: "usd" })).toBe("paid");
    expect((await db().query.orders.findFirst({ where: eq(schema.orders.id, a.orderId) }))!.status).toBe("confirmed");
    expect((await dayUsage(date, s)).remaining).toBe(-1);
  });

  it("uses audited per-day overrides and skips full days for the earliest date", async () => {
    const s = await configureShop({ dailyCapacityUnits: 5, minLeadTimeHours: 0 });
    const actor = await createAdmin();
    const date = futureDate(3);
    expect(await setCapacityOverride(actor, date, 0, "")).toMatchObject({ ok: false });
    expect(await setCapacityOverride(actor, date, 0, "Wedding fair")).toMatchObject({ ok: true });
    const days = await usageRange(date, addDays(date, 1), s);
    expect(days[0]).toMatchObject({ capacity: 0, overridden: true });
    expect(days[1]).toMatchObject({ capacity: 5, overridden: false });
    const log = await db().query.auditLog.findFirst({ where: eq(schema.auditLog.action, "capacity.override_set") });
    expect(log!.details).toMatchObject({ to: 0, reason: "Wedding fair" });
    const { full } = await earliestDateFor({ leadTimeHours: 0, capacityUnits: 1 }, s);
    expect(full).toContain(date);
  });
});

describe("discount codes", () => {
  it("applies percentage codes server-side with minimums, dates and limits", async () => {
    await configureShop();
    await db().insert(schema.discounts).values([
      { code: "TEN", kind: "percent", value: 1000, minSubtotalCents: 3000 },
      { code: "OLD", kind: "fixed", value: 500, endsAt: new Date(Date.now() - 1000) },
      { code: "OFF", kind: "fixed", value: 500, active: false },
    ]);
    expect(await checkDiscount("ten", 2000)).toMatchObject({ ok: false, message: expect.stringMatching(/at least/) });
    expect(await checkDiscount(" ten ", 4500)).toMatchObject({ ok: true, amountCents: 450 });
    expect(await checkDiscount("OLD", 4500)).toMatchObject({ ok: false, message: expect.stringMatching(/expired/) });
    expect(await checkDiscount("OFF", 4500)).toMatchObject({ ok: false });
    expect(await checkDiscount("NOPE", 4500)).toMatchObject({ ok: false });
  });

  it("taxes the discounted amount and records the redemption", async () => {
    await configureShop();
    await db().insert(schema.discounts).values({ code: "FIVE", kind: "fixed", value: 500 });
    const { product, values } = await createTestProduct();
    const res = await placeOrder(checkout(product.id, values.small.id, { discountCode: "five" }));
    if (!res.ok) throw new Error(res.message);
    const order = await db().query.orders.findFirst({ with: { redemption: true } });
    // 4,000 − 500 = 3,500; 8% tax = 280.
    expect(order).toMatchObject({ subtotalCents: 4000, discountCents: 500, discountCode: "FIVE", taxCents: 280, totalCents: 3780 });
    expect(order!.redemption?.status).toBe("pending");
  });

  it("never exceeds a code's redemption limit under concurrent checkouts", async () => {
    await configureShop();
    await db().insert(schema.discounts).values({ code: "LIMITED", kind: "fixed", value: 500, maxRedemptions: 2 });
    const { product, values } = await createTestProduct();
    const results = await Promise.all(Array.from({ length: 6 }, () => placeOrder(checkout(product.id, values.small.id, { discountCode: "LIMITED" }))));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(await db().query.discountRedemptions.findMany()).toHaveLength(2);
  });

  it("enforces a per-customer limit", async () => {
    await configureShop();
    await db().insert(schema.discounts).values({ code: "WELCOME", kind: "percent", value: 1000, maxPerCustomer: 1 });
    const { product, values } = await createTestProduct();
    expect((await placeOrder(checkout(product.id, values.small.id, { discountCode: "WELCOME", customerEmail: "a@x.test" }))).ok).toBe(true);
    expect(await placeOrder(checkout(product.id, values.small.id, { discountCode: "WELCOME", customerEmail: "A@x.test" }))).toMatchObject({ ok: false, fieldErrors: { discountCode: expect.stringMatching(/already used/) } });
  });
});

describe("discount admin", () => {
  it("normalises codes, validates amounts, prevents duplicates and audits", async () => {
    const actor = await createAdmin();
    const base = { description: null, kind: "percent" as const, minSubtotalCents: 0, startsOn: null, endsOn: null, maxRedemptions: null, maxPerCustomer: null, active: true };
    expect(discountInputSchema.safeParse({ ...base, code: "x", value: 1000 }).success).toBe(false);
    expect(discountInputSchema.safeParse({ ...base, code: "BIG", value: 12_000 }).success).toBe(false);
    const input = discountInputSchema.parse({ ...base, code: " spring 10 ", value: 1000, endsOn: futureDate(10) });
    expect(input.code).toBe("SPRING10");
    const created = await saveDiscount(actor, null, input, "America/New_York");
    expect(created.ok).toBe(true);
    expect(await saveDiscount(actor, null, input, "America/New_York")).toMatchObject({ ok: false });
    expect(await checkDiscount("spring10", 5000)).toMatchObject({ ok: true, amountCents: 500 });
    expect((await listDiscounts())[0]).toMatchObject({ code: "SPRING10", confirmedUses: 0 });
    expect(await db().query.auditLog.findFirst({ where: eq(schema.auditLog.action, "discount.created") })).toBeTruthy();
  });
});

describe("exports", () => {
  it("quotes CSV cells and neutralises spreadsheet formulas", () => {
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("+1 555")).toBe(`"'+1 555"`);
    expect(csvCell(null)).toBe('""');
  });
});

describe("notifications outbox", () => {
  const email = renderEmail({ subject: "Hi", heading: "Hello", blocks: [{ type: "p", text: "Body" }], businessName: "Sweets by Shyee" });

  it("ignores a duplicate key, so retried events can't send twice", async () => {
    expect(await enqueue(db(), { kind: "t", dedupeKey: "k1", to: "a@x.test", email })).not.toBeNull();
    expect(await enqueue(db(), { kind: "t", dedupeKey: "k1", to: "a@x.test", email })).toBeNull();
    await deliverDue();
    expect(await sentTo("a@x.test")).toHaveLength(1);
  });

  it("retries failures with backoff and gives up after the maximum attempts", async () => {
    await enqueue(db(), { kind: "t", dedupeKey: "k2", to: "b@x.test", email });
    failNextEmails(MAX_ATTEMPTS);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await db().update(schema.notifications).set({ nextAttemptAt: new Date(0) });
      await deliverDue();
    }
    const n = (await db().query.notifications.findFirst())!;
    expect(n).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(n.lastError).toMatch(/Simulated/);
  });

  it("escapes customer content in HTML emails", () => {
    const html = renderEmail({ subject: "x", heading: "<b>h</b>", blocks: [{ type: "rows", rows: [["Design", '<img src=x onerror="alert(1)">']] }], businessName: "Sweets by Shyee" }).html;
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;b&gt;h&lt;/b&gt;");
  });

  it("the job runner runs every task even if one fails", async () => {
    await configureShop();
    const results = await runJobs();
    expect(Object.keys(results)).toEqual(["payments", "holds", "quotes", "balanceReminders", "notifications", "rateLimits"]);
  });
});

describe("merchandising and reports", () => {
  it("derives new arrivals from publish dates and bestsellers from paid orders only", async () => {
    const s = await configureShop();
    const { product, values } = await createTestProduct({ publishedAt: new Date() });
    await createTestProduct({ slug: "old", publishedAt: new Date(Date.now() - 90 * 86_400_000) });
    expect((await listNewArrivals(30)).map((p) => p.id)).toEqual([product.id]);
    expect(await listBestsellers(2)).toEqual([]);
    for (const id of ["e1", "e2"]) {
      const res = await placeOrder(checkout(product.id, values.small.id));
      if (!res.ok) throw new Error(res.message);
      const pay = (await db().query.payments.findFirst({ where: eq(schema.payments.orderId, res.orderId) }))!;
      await handlePaymentEvent({ id, provider: "fake", type: "paid", sessionId: pay.providerSessionId, paymentIntentId: id, amountTotalCents: pay.amountCents, currency: "usd" });
    }
    // An unpaid order doesn't count.
    await placeOrder(checkout(product.id, values.small.id));
    expect((await listBestsellers(2)).map((p) => p.id)).toEqual([product.id]);
    expect(await listBestsellers(3)).toEqual([]);
    const summary = await salesSummary("today", s);
    expect(summary).toMatchObject({ ordersConfirmed: 2, paymentsCount: 2, receivedCents: 2 * 4320, refundedCents: 0, netCents: 2 * 4320, averageOrderCents: 4320 });
  });
});
