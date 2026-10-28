import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { getIngredient, listIngredients, lowStock, productCosts, recordMovement, saveIngredient, saveRecipe, saveSupplier, stockForOrder } from "@/lib/inventory";
import { checkoutSchema, handlePaymentEvent, placeOrder, updateOrderStatus } from "@/lib/orders";
import { configureShop, createAdmin, createTestProduct, futureDate, resetDb } from "../support/db";

beforeEach(resetDb);

async function ingredient(actor: { id: string; label: string }, name: string, unit: "g" | "ml" | "each", costPerUnitCents: number | null = null) {
  const res = await saveIngredient(actor, null, { name, unit, supplierId: null, costPerUnitCents, reorderLevel: null, notes: null, active: true });
  if (!res.ok) throw new Error(res.message);
  return res.id;
}

/** A paid shop order for `quantity` of the test cake. */
async function paidOrder(productId: string, valueId: string, quantity: number) {
  const res = await placeOrder(
    checkoutSchema.parse({ cart: [{ productId, optionValueIds: [valueId], quantity }], customerName: "Sam", customerEmail: "sam@example.test", fulfillmentMethod: "pickup", fulfillmentDate: futureDate(6) }),
  );
  if (!res.ok) throw new Error(res.message);
  const pay = (await db().query.payments.findFirst({ where: eq(schema.payments.orderId, res.orderId) }))!;
  await handlePaymentEvent({ id: `evt-${res.orderId}`, provider: "fake", type: "paid", sessionId: pay.providerSessionId, paymentIntentId: "pi", amountTotalCents: pay.amountCents, currency: "usd" });
  return res.orderId;
}

describe("stock ledger", () => {
  it("records deliveries (updating cost), stocktakes and waste, and audits them", async () => {
    const actor = await createAdmin("production");
    const flour = await ingredient(actor, "Flour", "g");
    expect(await recordMovement(actor, flour, { type: "receipt", quantity: 5000, totalCostCents: 1000, note: "Weekly order" })).toMatchObject({ ok: true, onHand: 5000 });
    expect((await getIngredient(flour))!.costPerUnitCents).toBe(0.2);
    expect(await recordMovement(actor, flour, { type: "waste", quantity: 250, note: "Spilled" })).toMatchObject({ ok: true, onHand: 4750 });
    expect(await recordMovement(actor, flour, { type: "stocktake", counted: 4600, note: "Weekly count" })).toMatchObject({ ok: true, quantity: -150, onHand: 4600 });
    expect(await recordMovement(actor, flour, { type: "stocktake", counted: 4600, note: "Recount" })).toMatchObject({ ok: true, changed: false });
    const detail = (await getIngredient(flour))!;
    expect(detail.onHand).toBe(4600);
    expect(detail.movements.map((m) => m.kind)).toEqual(["adjustment", "waste", "receipt"]);
    const log = await db().query.auditLog.findFirst({ where: eq(schema.auditLog.action, "stock.receipt") });
    expect(log!.details).toMatchObject({ quantity: 5000, cost: { from: null, to: 0.2 } });
  });

  it("flags low stock at or below the reorder level", async () => {
    const actor = await createAdmin();
    const res = await saveIngredient(actor, null, { name: "Eggs", unit: "each", supplierId: null, costPerUnitCents: 30, reorderLevel: 24, notes: null, active: true });
    if (!res.ok) throw new Error();
    await recordMovement(actor, res.id, { type: "receipt", quantity: 30, totalCostCents: null, note: null });
    expect(await lowStock()).toHaveLength(0);
    await recordMovement(actor, res.id, { type: "waste", quantity: 6, note: "Cracked" });
    expect((await lowStock()).map((i) => i.name)).toEqual(["Eggs"]);
  });

  it("won't change an ingredient's unit once it has stock, and keeps names unique", async () => {
    const actor = await createAdmin();
    const flour = await ingredient(actor, "Flour", "g");
    await recordMovement(actor, flour, { type: "receipt", quantity: 100, totalCostCents: null, note: null });
    expect(await saveIngredient(actor, flour, { name: "Flour", unit: "ml", supplierId: null, costPerUnitCents: null, reorderLevel: null, notes: null, active: true })).toMatchObject({ ok: false });
    expect(await saveIngredient(actor, null, { name: "Flour", unit: "g", supplierId: null, costPerUnitCents: null, reorderLevel: null, notes: null, active: true })).toMatchObject({ ok: false });
  });

  it("links ingredients to suppliers", async () => {
    const actor = await createAdmin();
    const sup = await saveSupplier(actor, null, { name: "Mill Co", contactName: null, email: "orders@mill.test", phone: null, website: null, notes: null, active: true });
    if (!sup.ok) throw new Error();
    await saveIngredient(actor, null, { name: "Flour", unit: "g", supplierId: sup.id, costPerUnitCents: null, reorderLevel: null, notes: null, active: true });
    expect((await listIngredients())[0].supplier?.name).toBe("Mill Co");
  });
});

describe("recipes, costing and order usage", () => {
  async function setup() {
    await configureShop();
    const actor = await createAdmin();
    const { product, values } = await createTestProduct();
    const flour = await ingredient(actor, "Flour", "g", 0.2);
    const eggs = await ingredient(actor, "Eggs", "each", 30);
    await recordMovement(actor, flour, { type: "receipt", quantity: 2000, totalCostCents: 400, note: null });
    await recordMovement(actor, eggs, { type: "receipt", quantity: 24, totalCostCents: 720, note: null });
    // One batch makes 2 cakes.
    expect(await saveRecipe(actor, product.id, { yieldQuantity: 2, notes: null, items: [{ ingredientId: flour, quantity: 500 }, { ingredientId: eggs, quantity: 8 }] })).toMatchObject({ ok: true });
    return { actor, product, values, flour, eggs };
  }

  it("costs a product from its recipe", async () => {
    const { product } = await setup();
    // (500 g × 0.2¢ + 8 × 30¢) ÷ 2 = 170¢
    expect((await productCosts([product.id])).get(product.id)).toEqual({ cents: 170, missing: [] });
  });

  it("uses stock once when an order goes into production, and returns it if cancelled", async () => {
    const { actor, product, values, flour, eggs } = await setup();
    const orderId = await paidOrder(product.id, values.small.id, 3);
    expect((await getIngredient(flour))!.onHand).toBe(2000); // nothing used on payment

    expect(await updateOrderStatus(actor, orderId, "in_production")).toMatchObject({ ok: true });
    expect((await getIngredient(flour))!.onHand).toBe(1250); // 3 ÷ 2 batches × 500 g
    expect((await getIngredient(eggs))!.onHand).toBe(12);

    // Hold and resume doesn't deduct twice.
    await updateOrderStatus(actor, orderId, "on_hold", { reason: "Waiting" });
    await updateOrderStatus(actor, orderId, "in_production");
    expect((await getIngredient(flour))!.onHand).toBe(1250);

    await updateOrderStatus(actor, orderId, "cancelled", { reason: "Customer cancelled" });
    expect((await getIngredient(flour))!.onHand).toBe(2000);
    expect((await stockForOrder(orderId)).map((m) => m.kind).sort()).toEqual(["reversal", "reversal", "usage", "usage"]);
  });

  it("cancelling before production changes no stock", async () => {
    const { actor, product, values, flour } = await setup();
    const orderId = await paidOrder(product.id, values.small.id, 1);
    await updateOrderStatus(actor, orderId, "cancelled", { reason: "Changed plans" });
    expect((await getIngredient(flour))!.onHand).toBe(2000);
    expect(await stockForOrder(orderId)).toHaveLength(0);
  });

  it("skips orders made from custom quotes, whose lines are free text", async () => {
    const { actor, product, values, flour } = await setup();
    const orderId = await paidOrder(product.id, values.small.id, 1);
    // Mark it as quote-derived the way acceptQuote does.
    const inquiry = await db()
      .insert(schema.inquiries)
      .values({ reference: "REQ-TEST-0001", customerName: "Sam", customerEmail: "sam@example.test", eventDate: futureDate(30), eventType: "Birthday", productType: "Cake", design: "x", fulfillmentMethod: "pickup", consentToContact: true })
      .returning();
    const [quote] = await db().insert(schema.quotes).values({ inquiryId: inquiry[0].id, reference: "QTE-TEST-0001", version: 1, fulfillmentMethod: "pickup", fulfillmentDate: futureDate(30) }).returning();
    await db().update(schema.orders).set({ sourceQuoteId: quote.id }).where(eq(schema.orders.id, orderId));
    await updateOrderStatus(actor, orderId, "in_production");
    expect((await getIngredient(flour))!.onHand).toBe(2000);
  });

  it("removes a recipe when saved with no ingredients", async () => {
    const { actor, product } = await setup();
    expect(await saveRecipe(actor, product.id, { yieldQuantity: 1, notes: null, items: [] })).toMatchObject({ ok: true });
    expect((await productCosts([product.id])).size).toBe(0);
  });
});
