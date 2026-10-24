import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export const productStatus = pgEnum("product_status", ["draft", "active", "unavailable", "archived"]);

/** Where a record's content came from; anything not "verified" needs owner review before launch. */
export const migrationStatus = pgEnum("migration_status", [
  "verified",
  "needs_review",
  "owner_created",
]);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  sourceUrl: text("source_url"),
  ...timestamps,
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    summary: text("summary"),
    description: text("description"),
    status: productStatus("status").notNull().default("draft"),
    /** Price in minor units (cents). Null means "price on request". */
    basePriceCents: integer("base_price_cents"),
    currency: text("currency").notNull().default("usd"),
    /** Can be bought through checkout. Requires a base price. */
    directPurchase: boolean("direct_purchase").notNull().default(false),
    /** Can be requested through the custom-order form. */
    customOrder: boolean("custom_order").notNull().default(false),
    servings: text("servings"),
    ingredients: text("ingredients"),
    allergens: text("allergens"),
    /** Minimum notice in hours between ordering and fulfilment. */
    leadTimeHours: integer("lead_time_hours"),
    pickupEligible: boolean("pickup_eligible").notNull().default(true),
    deliveryEligible: boolean("delivery_eligible").notNull().default(false),
    /** Max quantity per order line, null for no limit. */
    maxPerOrder: integer("max_per_order"),
    featured: boolean("featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    sourceUrl: text("source_url"),
    migrationStatus: migrationStatus("migration_status").notNull().default("owner_created"),
    migrationNotes: text("migration_notes"),
    ...timestamps,
  },
  (t) => [index("products_category_idx").on(t.categoryId), index("products_status_idx").on(t.status)],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Public path, e.g. /images/products/x.jpg or /media/<key>. */
    src: text("src").notNull(),
    alt: text("alt").notNull().default(""),
    width: integer("width"),
    height: integer("height"),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceUrl: text("source_url"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

/** A configurable choice on a product, e.g. "Size" or "Flavour". */
export const productOptions = pgTable(
  "product_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    required: boolean("required").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("product_options_product_idx").on(t.productId)],
);

export const productOptionValues = pgTable(
  "product_option_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    optionId: uuid("option_id")
      .notNull()
      .references(() => productOptions.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    priceDeltaCents: integer("price_delta_cents").notNull().default(0),
    available: boolean("available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("product_option_values_option_idx").on(t.optionId)],
);

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export const orderStatus = pgEnum("order_status", [
  "pending_payment",
  "paid",
  "in_progress",
  "ready",
  "completed",
  "cancelled",
  "payment_failed",
  "refunded",
]);

export const fulfillmentMethod = pgEnum("fulfillment_method", ["pickup", "delivery"]);

export type DeliveryAddress = {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
};

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    status: orderStatus("status").notNull().default("pending_payment"),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone"),
    fulfillmentMethod: fulfillmentMethod("fulfillment_method").notNull(),
    fulfillmentDate: date("fulfillment_date", { mode: "string" }).notNull(),
    deliveryAddress: jsonb("delivery_address").$type<DeliveryAddress>(),
    notes: text("notes"),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    /** Tax rate applied, in basis points, recorded for audit. */
    taxRateBps: integer("tax_rate_bps").notNull(),
    paymentProvider: text("payment_provider"),
    paymentSessionId: text("payment_session_id").unique(),
    paymentIntentId: text("payment_intent_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** sha256 of the token in the customer's confirmation link. */
    accessTokenHash: text("access_token_hash").notNull(),
    sourceInquiryId: uuid("source_inquiry_id"),
    confirmationEmailSentAt: timestamp("confirmation_email_sent_at", { withTimezone: true }),
    internalNotes: text("internal_notes"),
    ...timestamps,
  },
  (t) => [index("orders_status_idx").on(t.status), index("orders_created_idx").on(t.createdAt)],
);

export type OrderItemOption = { option: string; value: string; priceDeltaCents: number };

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    /** Snapshots so the order stays accurate if the product changes later. */
    productName: text("product_name").notNull(),
    options: jsonb("options").$type<OrderItemOption[]>().notNull().default([]),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

/** Payment-provider events already handled; the primary key makes processing idempotent. */
export const paymentEvents = pgTable("payment_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  type: text("type").notNull(),
  orderId: uuid("order_id"),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Custom-order inquiries                                              */
/* ------------------------------------------------------------------ */

export const inquiryStatus = pgEnum("inquiry_status", [
  "new",
  "reviewing",
  "quoted",
  "accepted",
  "declined",
  "completed",
]);

export const inquiries = pgTable(
  "inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    status: inquiryStatus("status").notNull().default("new"),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone"),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    eventType: text("event_type").notNull(),
    productType: text("product_type").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    servings: integer("servings"),
    tiers: integer("tiers"),
    flavours: text("flavours"),
    size: text("size"),
    design: text("design").notNull(),
    theme: text("theme"),
    colours: text("colours"),
    message: text("message"),
    fulfillmentMethod: fulfillmentMethod("fulfillment_method").notNull(),
    deliveryAddress: jsonb("delivery_address").$type<DeliveryAddress>(),
    allergies: text("allergies"),
    budget: text("budget"),
    details: text("details"),
    consentToContact: boolean("consent_to_contact").notNull().default(true),
    quotedPriceCents: integer("quoted_price_cents"),
    quoteNotes: text("quote_notes"),
    internalNotes: text("internal_notes"),
    convertedOrderId: uuid("converted_order_id"),
    businessEmailStatus: text("business_email_status").notNull().default("pending"),
    customerEmailStatus: text("customer_email_status").notNull().default("pending"),
    ...timestamps,
  },
  (t) => [index("inquiries_status_idx").on(t.status), index("inquiries_created_idx").on(t.createdAt)],
);

export const inquiryAttachments = pgTable(
  "inquiry_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => inquiries.id, { onDelete: "cascade" }),
    /** Key in private storage. Never served from a public path. */
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("inquiry_attachments_inquiry_idx").on(t.inquiryId)],
);

/* ------------------------------------------------------------------ */
/* Site content                                                        */
/* ------------------------------------------------------------------ */

export const faqs = pgTable("faqs", {
  id: uuid("id").primaryKey().defaultRandom(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  published: boolean("published").notNull().default(true),
  sourceUrl: text("source_url"),
  ...timestamps,
});

/** Long-form pages: about, policies, etc. Body is plain text with blank-line paragraphs. */
export const pages = pgTable("pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  kind: text("kind").notNull().default("policy"),
  published: boolean("published").notNull().default(true),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  sourceUrl: text("source_url"),
  ...timestamps,
});

export const galleryItems = pgTable("gallery_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  src: text("src").notNull(),
  alt: text("alt").notNull(),
  caption: text("caption"),
  collection: text("collection"),
  width: integer("width"),
  height: integer("height"),
  featured: boolean("featured").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  published: boolean("published").notNull().default(true),
  sourceUrl: text("source_url"),
  createdAt: timestamps.createdAt,
});

export const testimonials = pgTable("testimonials", {
  id: uuid("id").primaryKey().defaultRandom(),
  quote: text("quote").notNull(),
  author: text("author").notNull(),
  context: text("context"),
  /** Only testimonials the owner has confirmed are genuine and may be published. */
  verified: boolean("verified").notNull().default(false),
  published: boolean("published").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  sourceUrl: text("source_url"),
  createdAt: timestamps.createdAt,
});

/** Single-row store of business settings, keyed by "site". */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamps.updatedAt,
});

/* ------------------------------------------------------------------ */
/* Administration                                                      */
/* ------------------------------------------------------------------ */

export const adminRole = pgEnum("admin_role", ["owner", "staff"]);

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: adminRole("role").notNull().default("staff"),
  active: boolean("active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

export const adminSessions = pgTable(
  "admin_sessions",
  {
    /** sha256 of the session token; the raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamps.createdAt,
    userAgent: text("user_agent"),
  },
  (t) => [index("admin_sessions_user_idx").on(t.userId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => adminUsers.id, { onDelete: "set null" }),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId), index("audit_log_created_idx").on(t.createdAt)],
);

/** Fixed-window counters for rate limiting, shared across server instances. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("rate_limits_key_window_idx").on(t.key, t.windowStart)],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const categoriesRelations = relations(categories, ({ many }) => ({ products: many(products) }));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  images: many(productImages),
  options: many(productOptions),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}));

export const productOptionsRelations = relations(productOptions, ({ one, many }) => ({
  product: one(products, { fields: [productOptions.productId], references: [products.id] }),
  values: many(productOptionValues),
}));

export const productOptionValuesRelations = relations(productOptionValues, ({ one }) => ({
  option: one(productOptions, { fields: [productOptionValues.optionId], references: [productOptions.id] }),
}));

export const ordersRelations = relations(orders, ({ many }) => ({ items: many(orderItems) }));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));

export const inquiriesRelations = relations(inquiries, ({ many, one }) => ({
  attachments: many(inquiryAttachments),
  product: one(products, { fields: [inquiries.productId], references: [products.id] }),
}));

export const inquiryAttachmentsRelations = relations(inquiryAttachments, ({ one }) => ({
  inquiry: one(inquiries, { fields: [inquiryAttachments.inquiryId], references: [inquiries.id] }),
}));

export const adminSessionsRelations = relations(adminSessions, ({ one }) => ({
  user: one(adminUsers, { fields: [adminSessions.userId], references: [adminUsers.id] }),
}));

