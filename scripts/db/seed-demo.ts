/**
 * DEMO DATA for local development, screenshots and end-to-end tests only.
 *
 * Every record is clearly labelled as a sample. None of it describes the real
 * Sweets by Shyee menu, prices or policies, which come from the content
 * migration (pnpm db:seed) and owner review. Refuses to run in production.
 */
import { sql } from "drizzle-orm";
import { closeDb, db, redactedUrl, schema } from "../lib/db";

const appEnv = process.env.APP_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "local");
if (appEnv !== "local" && appEnv !== "test") {
  console.error(`Refusing to load demo data when APP_ENV=${appEnv}. Demo data is for local and test databases only.`);
  process.exit(1);
}

const reset = process.argv.includes("--reset");
if (reset) {
  await db.execute(sql`TRUNCATE stock_movements, recipe_items, recipes, ingredients, suppliers, notifications, discount_redemptions, discounts, capacity_reservations, capacity_overrides, refunds, payments, quote_lines, quotes, order_items, orders, customers, payment_events, product_collections, collections, inquiry_attachments, inquiries, product_option_values, product_options, product_images, products, categories, faqs, pages, gallery_items, testimonials, settings, rate_limits RESTART IDENTITY CASCADE`);
}

const existing = await db.query.products.findFirst();
if (existing && !reset) {
  console.log("Database already has products; pass --reset to replace everything with demo data.");
  await closeDb();
  process.exit(0);
}

const DEMO_NOTE = "DEMO DATA — sample content for testing, not the real menu.";

const [cakes, treats] = await db
  .insert(schema.categories)
  .values([
    { slug: "sample-cakes", name: "Sample Cakes", description: "Demo category.", sortOrder: 0 },
    { slug: "sample-treats", name: "Sample Treats", description: "Demo category.", sortOrder: 1 },
  ])
  .returning();

type DemoOption =
  | { name: string; required: boolean; values: [string, number, boolean?, number?][] }
  | { name: string; required: boolean; text: { maxLength: number; priceDeltaCents: number; helpText: string } };

async function product(p: typeof schema.products.$inferInsert, options: DemoOption[] = []) {
  const publishedAt = p.status === "active" ? new Date() : null;
  const [row] = await db.insert(schema.products).values({ migrationStatus: "owner_created", migrationNotes: DEMO_NOTE, publishedAt, ...p }).returning();
  for (const [i, o] of options.entries()) {
    if ("text" in o) {
      await db.insert(schema.productOptions).values({ productId: row.id, name: o.name, kind: "text", required: o.required, sortOrder: i, ...o.text });
      continue;
    }
    const [opt] = await db.insert(schema.productOptions).values({ productId: row.id, name: o.name, required: o.required, sortOrder: i }).returning();
    await db.insert(schema.productOptionValues).values(o.values.map(([label, delta, available = true, recipeScale = 1], j) => ({ optionId: opt.id, label, priceDeltaCents: delta, available, recipeScale, sortOrder: j })));
  }
  return row;
}

const celebration = await product(
  { slug: "sample-celebration-cake", name: "Sample Celebration Cake", categoryId: cakes.id, summary: "Demo product with size and flavour options.", description: `${DEMO_NOTE}\n\nUse this product to try the cart, options and checkout flow.`, status: "active", basePriceCents: 4500, directPurchase: true, customOrder: true, leadTimeHours: 72, pickupEligible: true, deliveryEligible: true, featured: true, sortOrder: 0, servings: "Sample: 8–12", capacityUnits: 2 },
  [
    { name: "Size", required: true, values: [['6" round', 0], ['8" round', 1500, true, 1.5], ['10" round', 3000, false, 2]] },
    { name: "Flavour", required: true, values: [["Sample vanilla", 0], ["Sample chocolate", 0], ["Sample lemon", 300]] },
    { name: "Message on cake", required: false, text: { maxLength: 30, priceDeltaCents: 300, helpText: "Demo personalisation option." } },
  ],
);
const cupcakes = await product(
  { slug: "sample-cupcake-box", name: "Sample Cupcake Box", categoryId: treats.id, summary: "Demo product, pickup only.", description: DEMO_NOTE, status: "active", basePriceCents: 2400, directPurchase: true, customOrder: false, leadTimeHours: 48, pickupEligible: true, deliveryEligible: false, featured: true, sortOrder: 1 },
  [{ name: "Box size", required: true, values: [["6 pieces", 0], ["12 pieces", 2000]] }],
);
await product({ slug: "sample-tiered-cake", name: "Sample Tiered Cake", categoryId: cakes.id, summary: "Demo custom-order-only product.", description: DEMO_NOTE, status: "active", basePriceCents: null, directPurchase: false, customOrder: true, featured: true, sortOrder: 2, capacityUnits: 4 });
await product({ slug: "sample-seasonal-treat", name: "Sample Seasonal Treat", categoryId: treats.id, summary: "Demo product that is currently unavailable.", description: DEMO_NOTE, status: "unavailable", basePriceCents: 1800, directPurchase: true, sortOrder: 3 });

const [collection] = await db
  .insert(schema.collections)
  .values({ slug: "sample-collection", name: "Sample Collection", description: `${DEMO_NOTE} A demo seasonal collection.`, featured: true })
  .returning();
await db.insert(schema.productCollections).values([
  { productId: celebration.id, collectionId: collection.id, sortOrder: 0 },
  { productId: cupcakes.id, collectionId: collection.id, sortOrder: 1 },
]);
await db.insert(schema.discounts).values({ code: "DEMO10", description: DEMO_NOTE, kind: "percent", value: 1000 });

// Sample inventory: made-up quantities and costs, for trying the stock screens.
const [supplier] = await db.insert(schema.suppliers).values({ name: "Sample Supplier", notes: DEMO_NOTE }).returning();
const [flour, sugar, butter, eggs] = await db
  .insert(schema.ingredients)
  .values([
    { name: "Sample flour", unit: "g", supplierId: supplier.id, costPerUnitCents: 0.2, reorderLevel: 2000, notes: DEMO_NOTE },
    { name: "Sample sugar", unit: "g", supplierId: supplier.id, costPerUnitCents: 0.25, reorderLevel: 1000, notes: DEMO_NOTE },
    { name: "Sample butter", unit: "g", supplierId: supplier.id, costPerUnitCents: 1.2, reorderLevel: 1000, notes: DEMO_NOTE },
    { name: "Sample eggs", unit: "each", costPerUnitCents: 30, reorderLevel: 24, notes: DEMO_NOTE },
  ])
  .returning();
await db.insert(schema.stockMovements).values([
  { ingredientId: flour.id, kind: "receipt", quantity: 10000, unitCostCents: 0.2, note: DEMO_NOTE },
  { ingredientId: sugar.id, kind: "receipt", quantity: 5000, unitCostCents: 0.25, note: DEMO_NOTE },
  { ingredientId: butter.id, kind: "receipt", quantity: 3000, unitCostCents: 1.2, note: DEMO_NOTE },
  { ingredientId: eggs.id, kind: "receipt", quantity: 30, unitCostCents: 30, note: DEMO_NOTE },
]);
const [cakeRecipe, cupcakeRecipe] = await db
  .insert(schema.recipes)
  .values([
    { productId: celebration.id, yieldQuantity: 1, notes: DEMO_NOTE },
    { productId: cupcakes.id, yieldQuantity: 1, notes: DEMO_NOTE },
  ])
  .returning();
await db.insert(schema.recipeItems).values([
  { recipeId: cakeRecipe.id, ingredientId: flour.id, quantity: 300, sortOrder: 0 },
  { recipeId: cakeRecipe.id, ingredientId: sugar.id, quantity: 250, sortOrder: 1 },
  { recipeId: cakeRecipe.id, ingredientId: butter.id, quantity: 200, sortOrder: 2 },
  { recipeId: cakeRecipe.id, ingredientId: eggs.id, quantity: 4, sortOrder: 3 },
  { recipeId: cupcakeRecipe.id, ingredientId: flour.id, quantity: 150, sortOrder: 0 },
  { recipeId: cupcakeRecipe.id, ingredientId: sugar.id, quantity: 120, sortOrder: 1 },
  { recipeId: cupcakeRecipe.id, ingredientId: butter.id, quantity: 100, sortOrder: 2 },
  { recipeId: cupcakeRecipe.id, ingredientId: eggs.id, quantity: 2, sortOrder: 3 },
]);

await db.insert(schema.faqs).values([
  { question: "Sample question: how far ahead should I order?", answer: `${DEMO_NOTE} Replace with the bakery's real lead-time policy.`, sortOrder: 0 },
  { question: "Sample question: do you deliver?", answer: `${DEMO_NOTE} Replace with the bakery's real delivery policy.`, sortOrder: 1 },
]);
await db.insert(schema.pages).values({ slug: "sample-policy", title: "Sample Policy", body: `${DEMO_NOTE}\n\nReplace with the bakery's real policies.`, kind: "policy" });

await db.insert(schema.settings).values({
  key: "site",
  value: {
    businessName: "Sweets by Shyee",
    // From the owner's logo.
    tagline: "Homemade bakes · Freshly crafted",
    heroHeading: "Sweets by Shyee",
    heroSubheading: "Demo homepage text — replace with the bakery's own introduction in Admin → Settings.",
    announcement: "Demo environment: products, prices and payments are samples.",
    contactEmail: "demo@example.com",
    taxRateBps: 800,
    taxLabel: "Sales tax (demo rate)",
    pickupEnabled: true,
    pickupInstructions: "Demo pickup instructions.",
    deliveryEnabled: true,
    deliveryFeeCents: 1500,
    deliveryArea: "Demo delivery area",
    minLeadTimeHours: 48,
    maxAdvanceDays: 90,
    fulfillmentWeekdays: [1, 2, 3, 4, 5, 6, 7],
    timezone: "America/New_York",
    checkoutEnabled: true,
    customOrdersEnabled: true,
    customOrderMinNoticeDays: 7,
    dailyCapacityUnits: 12,
    fulfillmentWindows: ["Sample 10:00–12:00", "Sample 14:00–16:00"],
    depositPercentBps: 5000,
  },
});

console.log(`Demo data loaded into ${redactedUrl()}`);
await closeDb();
