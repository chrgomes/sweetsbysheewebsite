import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { memoryOutbox } from "@/lib/email";
import { saveSettings, DEFAULT_SETTINGS, type SiteSettings } from "@/lib/settings";

/** Empty every table between tests. */
export async function resetDb() {
  const tables = [
    "stock_movements", "recipe_items", "recipes", "ingredients", "suppliers",
    "audit_log", "admin_sessions", "admin_users", "payment_events", "refunds", "payments", "discount_redemptions", "discounts",
    "capacity_reservations", "capacity_overrides", "notifications", "order_items", "orders", "quote_lines", "quotes",
    "inquiry_attachments", "inquiries", "customers", "product_collections", "collections", "product_option_values",
    "product_options", "product_images", "products", "categories", "faqs", "pages", "gallery_items", "testimonials",
    "settings", "rate_limits",
  ];
  await db().execute(sql.raw(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`));
  memoryOutbox().length = 0;
}

/** Settings with checkout fully configured, for tests only. */
export const READY_SETTINGS: SiteSettings = {
  ...DEFAULT_SETTINGS,
  contactEmail: "hello@example.test",
  taxRateBps: 800,
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryFeeCents: 1500,
  fulfillmentWeekdays: [1, 2, 3, 4, 5, 6, 7],
  minLeadTimeHours: 48,
  checkoutEnabled: true,
  timezone: "UTC",
};

export async function configureShop(overrides: Partial<SiteSettings> = {}) {
  return saveSettings({ ...READY_SETTINGS, ...overrides });
}

/** A test product with a required size option and an optional add-on. */
export async function createTestProduct(overrides: Partial<typeof schema.products.$inferInsert> = {}) {
  const [product] = await db()
    .insert(schema.products)
    .values({
      slug: `test-product-${Math.random().toString(36).slice(2, 8)}`,
      name: "Test Cake",
      status: "active",
      basePriceCents: 4000,
      directPurchase: true,
      customOrder: true,
      leadTimeHours: 72,
      ...overrides,
    })
    .returning();
  const [size] = await db().insert(schema.productOptions).values({ productId: product.id, name: "Size", required: true }).returning();
  const [small, large, soldOut] = await db()
    .insert(schema.productOptionValues)
    .values([
      { optionId: size.id, label: '6"', priceDeltaCents: 0, sortOrder: 0 },
      { optionId: size.id, label: '8"', priceDeltaCents: 1500, sortOrder: 1 },
      { optionId: size.id, label: '10"', priceDeltaCents: 3000, sortOrder: 2, available: false },
    ])
    .returning();
  const [addOn] = await db().insert(schema.productOptions).values({ productId: product.id, name: "Topper", required: false, sortOrder: 1 }).returning();
  const [topper] = await db().insert(schema.productOptionValues).values({ optionId: addOn.id, label: "Gold topper", priceDeltaCents: 500 }).returning();
  const [message] = await db()
    .insert(schema.productOptions)
    .values({ productId: product.id, name: "Message", kind: "text", required: false, maxLength: 20, priceDeltaCents: 300, sortOrder: 2 })
    .returning();
  return { product, values: { small, large, soldOut, topper }, message };
}

export function futureDate(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** All emails in the in-memory outbox addressed to `to`. */
export async function sentTo(to: string) {
  const { memoryOutbox } = await import("@/lib/email");
  return memoryOutbox().filter((m) => m.to === to);
}

export async function createAdmin(role: "owner" | "admin" | "order_manager" | "production" | "reporting" = "owner") {
  const [u] = await db()
    .insert(schema.adminUsers)
    .values({ email: `${role}-${Math.random().toString(36).slice(2, 7)}@example.test`, name: role, passwordHash: "x", role })
    .returning();
  return { id: u.id, label: u.email };
}
