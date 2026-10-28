import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { getIngredient, ingredientForecast, listIngredients, lowStock, productCosts, recordMovement, saveIngredient, saveRecipe, saveSupplier, stockForOrder } from "@/lib/inventory";
import { checkoutSchema, handlePaymentEvent, placeOrder, updateOrderStatus } from "@/lib/orders";
import { productSales } from "@/lib/reports";
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

  it("scales stock use by the chosen option's recipe multiplier", async () => {
    const { actor, product, values, flour, eggs } = await setup();
    await db().update(schema.productOptionValues).set({ recipeScale: 2 }).where(eq(schema.productOptionValues.id, values.large.id));
    const orderId = await paidOrder(product.id, values.large.id, 1);
    const item = (await db().query.orderItems.findFirst({ where: eq(schema.orderItems.orderId, orderId) }))!;
    expect(item.options).toContainEqual(expect.objectContaining({ valueId: values.large.id }));
    await updateOrderStatus(actor, orderId, "in_production");
    // 1 cake × 2 ÷ yield 2 = 1 batch
    expect((await getIngredient(flour))!.onHand).toBe(1500);
    expect((await getIngredient(eggs))!.onHand).toBe(16);
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

describe("ingredient forecast", () => {
  it("adds up upcoming orders that haven't used stock, and says what to buy", async () => {
    await configureShop();
    const actor = await createAdmin();
    const { product, values } = await createTestProduct();
    const res = await saveIngredient(actor, null, { name: "Flour", unit: "g", supplierId: null, costPerUnitCents: 0.2, reorderLevel: 500, notes: null, active: true });
    if (!res.ok) throw new Error();
    const flour = res.id;
    await recordMovement(actor, flour, { type: "receipt", quantity: 1000, totalCostCents: null, note: null });
    await saveRecipe(actor, product.id, { yieldQuantity: 1, notes: null, items: [{ ingredientId: flour, quantity: 400 }] });

    await paidOrder(product.id, values.small.id, 2); // 800 g
    const b = await paidOrder(product.id, values.small.id, 1); // 400 g
    // An order already in production has used its stock and isn't counted again.
    await updateOrderStatus(actor, b, "in_production");
    // Unpaid orders count only when asked.
    await placeOrder(checkoutSchema.parse({ cart: [{ productId: product.id, optionValueIds: [values.small.id], quantity: 1 }], customerName: "Pat", customerEmail: "pat@example.test", fulfillmentMethod: "pickup", fulfillmentDate: futureDate(6) }));

    const range = [futureDate(0), futureDate(10)] as const;
    const f = await ingredientForecast(...range);
    expect(f.orderCount).toBe(1);
    expect(f.rows).toEqual([expect.objectContaining({ id: flour, needed: 800, onHand: 600, after: -200, short: 200, toBuy: 700 })]);
    expect((await ingredientForecast(...range, { includePending: true })).rows[0]).toMatchObject({ needed: 1200, short: 600 });
    expect((await ingredientForecast(futureDate(20), futureDate(30))).rows).toEqual([]);
  });
});

describe("product sales report", () => {
  it("reports units, revenue and estimated ingredient cost for confirmed, uncancelled orders", async () => {
    const s = await configureShop();
    const actor = await createAdmin();
    const { product, values } = await createTestProduct();
    const res = await saveIngredient(actor, null, { name: "Flour", unit: "g", supplierId: null, costPerUnitCents: 0.5, reorderLevel: null, notes: null, active: true });
    if (!res.ok) throw new Error();
    await saveRecipe(actor, product.id, { yieldQuantity: 1, notes: null, items: [{ ingredientId: res.id, quantity: 400 }] }); // 200¢ per cake
    await db().update(schema.productOptionValues).set({ recipeScale: 1.5 }).where(eq(schema.productOptionValues.id, values.large.id));

    await paidOrder(product.id, values.small.id, 2); // 2 × 4000
    await paidOrder(product.id, values.large.id, 1); // 1 × 5500, cost 300
    const cancelled = await paidOrder(product.id, values.small.id, 5);
    await updateOrderStatus(actor, cancelled, "cancelled", { reason: "Changed plans" });
    await placeOrder(checkoutSchema.parse({ cart: [{ productId: product.id, optionValueIds: [values.small.id], quantity: 1 }], customerName: "Pat", customerEmail: "pat@example.test", fulfillmentMethod: "pickup", fulfillmentDate: futureDate(6) })); // unpaid

    const today = new Date().toISOString().slice(0, 10);
    const report = await productSales(today, today, s);
    expect(report.orders).toBe(2);
    expect(report.products).toEqual([expect.objectContaining({ productId: product.id, orders: 2, units: 3, revenueCents: 13500, costCents: 700, marginCents: 12800 })]);
    expect(report.daily).toEqual([{ date: today, revenueCents: 13500, orders: 2 }]);
  });
});
