import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { failNextEmails, memoryOutbox } from "@/lib/email";
import { convertInquiryToOrder, createInquiry, inquirySchema, type InquiryInput } from "@/lib/inquiries";
import { configureShop, futureDate, resetDb } from "../support/db";

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

beforeEach(async () => {
  await resetDb();
  await configureShop();
});

describe("inquiry validation", () => {
  it("requires the core fields and the acknowledgement", () => {
    const r = inquirySchema.safeParse({ customerName: "", customerEmail: "bad", eventDate: "2026-13-01", fulfillmentMethod: "pickup" });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["customerName", "customerEmail", "eventDate", "eventType", "productType", "design", "acknowledge"]));
  });
  it("requires an address only for delivery", () => {
    expect(() => input({ fulfillmentMethod: "delivery" })).toThrow();
    expect(input({ fulfillmentMethod: "delivery", deliveryAddress: { line1: "1 Main", city: "T", region: "NY", postalCode: "10001" } }).deliveryAddress).toBeTruthy();
  });
  it("normalises email and numbers", () => {
    const v = input();
    expect(v.customerEmail).toBe("riley@example.test");
    expect(v.servings).toBe(24);
  });
});

describe("createInquiry", () => {
  it("persists the request and attachments privately, and emails both parties", async () => {
    const res = await createInquiry(input(), [{ name: "idea.png", kind: { mime: "image/png", ext: "png" }, bytes: PNG }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.reference).toMatch(/^REQ-/);
    const row = await db().query.inquiries.findFirst({ where: eq(schema.inquiries.id, res.id), with: { attachments: true } });
    expect(row).toMatchObject({ status: "new", businessEmailStatus: "sent", customerEmailStatus: "sent", servings: 24 });
    expect(row!.attachments).toHaveLength(1);
    const stored = path.join(process.env.STORAGE_DIR!, "private", row!.attachments[0].storageKey);
    expect(existsSync(stored)).toBe(true);
    expect(stored).not.toContain(`${path.sep}public${path.sep}`);
    expect(memoryOutbox().map((m) => m.to).sort()).toEqual(["owner@example.test", "riley@example.test"]);
    expect(memoryOutbox().find((m) => m.to === "riley@example.test")!.text).toMatch(/not a confirmed order/);
  });

  it("rejects dates inside the minimum notice period", async () => {
    const res = await createInquiry(input({ eventDate: futureDate(2) }), []);
    expect(res).toMatchObject({ ok: false, fieldErrors: { eventDate: expect.stringMatching(/notice/) } });
  });

  it("still saves the request when email delivery fails, and records the failure", async () => {
    failNextEmails(2);
    const res = await createInquiry(input(), []);
    expect(res.ok).toBe(true);
    const row = await db().query.inquiries.findFirst();
    expect(row!.businessEmailStatus).toMatch(/^failed/);
    expect(row!.customerEmailStatus).toMatch(/^failed/);
  });

  it("can be switched off by the owner", async () => {
    await configureShop({ customOrdersEnabled: false });
    expect(await createInquiry(input(), [])).toMatchObject({ ok: false });
  });
});

describe("convertInquiryToOrder", () => {
  it("creates a payable order at the agreed price with tax", async () => {
    const res = await createInquiry(input(), []);
    if (!res.ok) throw new Error();
    await db().update(schema.inquiries).set({ quotedPriceCents: 25000, quoteNotes: "2 tiers, vanilla" }).where(eq(schema.inquiries.id, res.id));
    const actor = { id: null, label: "owner@test" };
    const conv = await convertInquiryToOrder(actor, res.id, { sendEmail: true });
    expect(conv).toMatchObject({ ok: true, emailed: true });
    const order = await db().query.orders.findFirst({ with: { items: true } });
    expect(order).toMatchObject({ status: "pending_payment", subtotalCents: 25000, taxCents: 2000, totalCents: 27000, sourceInquiryId: res.id });
    expect((await db().query.inquiries.findFirst())!.status).toBe("accepted");
    expect(await convertInquiryToOrder(actor, res.id, { sendEmail: false })).toMatchObject({ ok: false });
  });
  it("needs an agreed price", async () => {
    const res = await createInquiry(input(), []);
    if (!res.ok) throw new Error();
    expect(await convertInquiryToOrder({ id: null, label: "x" }, res.id, { sendEmail: false })).toMatchObject({ ok: false, message: expect.stringMatching(/price/) });
  });
});
