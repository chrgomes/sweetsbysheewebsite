/**
 * DEMO DATA for local development, screenshots and end-to-end tests only.
 *
 * Every record is clearly labelled as a sample. None of it describes the real
 * Sweets by Shee menu, prices or policies, which come from the content
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
  await db.execute(sql`TRUNCATE order_items, orders, payment_events, inquiry_attachments, inquiries, product_option_values, product_options, product_images, products, categories, faqs, pages, gallery_items, testimonials, settings, rate_limits RESTART IDENTITY CASCADE`);
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

async function product(p: typeof schema.products.$inferInsert, options: { name: string; required: boolean; values: [string, number, boolean?][] }[] = []) {
  const [row] = await db.insert(schema.products).values({ migrationStatus: "owner_created", migrationNotes: DEMO_NOTE, ...p }).returning();
  for (const [i, o] of options.entries()) {
    const [opt] = await db.insert(schema.productOptions).values({ productId: row.id, name: o.name, required: o.required, sortOrder: i }).returning();
    await db.insert(schema.productOptionValues).values(o.values.map(([label, delta, available = true], j) => ({ optionId: opt.id, label, priceDeltaCents: delta, available, sortOrder: j })));
  }
  return row;
}

await product(
  { slug: "sample-celebration-cake", name: "Sample Celebration Cake", categoryId: cakes.id, summary: "Demo product with size and flavour options.", description: `${DEMO_NOTE}\n\nUse this product to try the cart, options and checkout flow.`, status: "active", basePriceCents: 4500, directPurchase: true, customOrder: true, leadTimeHours: 72, pickupEligible: true, deliveryEligible: true, featured: true, sortOrder: 0, servings: "Sample: 8–12" },
  [
    { name: "Size", required: true, values: [['6" round', 0], ['8" round', 1500], ['10" round', 3000, false]] },
    { name: "Flavour", required: true, values: [["Sample vanilla", 0], ["Sample chocolate", 0], ["Sample lemon", 300]] },
  ],
);
await product(
  { slug: "sample-cupcake-box", name: "Sample Cupcake Box", categoryId: treats.id, summary: "Demo product, pickup only.", description: DEMO_NOTE, status: "active", basePriceCents: 2400, directPurchase: true, customOrder: false, leadTimeHours: 48, pickupEligible: true, deliveryEligible: false, featured: true, sortOrder: 1 },
  [{ name: "Box size", required: true, values: [["6 pieces", 0], ["12 pieces", 2000]] }],
);
await product({ slug: "sample-tiered-cake", name: "Sample Tiered Cake", categoryId: cakes.id, summary: "Demo custom-order-only product.", description: DEMO_NOTE, status: "active", basePriceCents: null, directPurchase: false, customOrder: true, featured: true, sortOrder: 2 });
await product({ slug: "sample-seasonal-treat", name: "Sample Seasonal Treat", categoryId: treats.id, summary: "Demo product that is currently unavailable.", description: DEMO_NOTE, status: "unavailable", basePriceCents: 1800, directPurchase: true, sortOrder: 3 });

await db.insert(schema.faqs).values([
  { question: "Sample question: how far ahead should I order?", answer: `${DEMO_NOTE} Replace with the bakery's real lead-time policy.`, sortOrder: 0 },
  { question: "Sample question: do you deliver?", answer: `${DEMO_NOTE} Replace with the bakery's real delivery policy.`, sortOrder: 1 },
]);
await db.insert(schema.pages).values({ slug: "sample-policy", title: "Sample Policy", body: `${DEMO_NOTE}\n\nReplace with the bakery's real policies.`, kind: "policy" });

await db.insert(schema.settings).values({
  key: "site",
  value: {
    businessName: "Sweets by Shee",
    tagline: null,
    heroHeading: "Sweets by Shee",
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
  },
});

console.log(`Demo data loaded into ${redactedUrl()}`);
await closeDb();
