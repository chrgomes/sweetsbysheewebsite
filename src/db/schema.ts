import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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
    /** Production capacity one unit of this product uses on its fulfilment day. */
    capacityUnits: integer("capacity_units").notNull().default(1),
    /** First time the product went live; drives "New arrivals". */
    publishedAt: timestamp("published_at", { withTimezone: true }),
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

/** "choice": pick one of the option's values. "text": free-text personalisation, e.g. a cake message. */
export const optionKind = pgEnum("option_kind", ["choice", "text"]);

/** A configurable option on a product, e.g. "Size", "Flavour" or "Message on cake". */
export const productOptions = pgTable(
  "product_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: optionKind("kind").notNull().default("choice"),
    required: boolean("required").notNull().default(true),
    /** Text options: maximum characters. */
    maxLength: integer("max_length"),
    /** Text options: surcharge when the customer fills it in. Choice options price per value. */
    priceDeltaCents: integer("price_delta_cents").notNull().default(0),
    helpText: text("help_text"),
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

/** Curated groups such as "Seasonal" or "Holiday", optionally limited to a date range. */
export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  /** Shown on the homepage while active and in season. */
  featured: boolean("featured").notNull().default(false),
  startsOn: date("starts_on", { mode: "string" }),
  endsOn: date("ends_on", { mode: "string" }),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const productCollections = pgTable(
  "product_collections",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.collectionId] }), index("product_collections_collection_idx").on(t.collectionId)],
);

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

/** One row per email address; groups a person's orders and requests. No login. */
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Lower-cased. */
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  internalNotes: text("internal_notes"),
  /** Set when personal data was erased on request; the row stays so financial records keep their link. */
  erasedAt: timestamp("erased_at", { withTimezone: true }),
  ...timestamps,
});

/* ------------------------------------------------------------------ */
/* Orders and payments                                                 */
/* ------------------------------------------------------------------ */

/** Fulfilment progress. Payment progress is tracked separately in `paymentStatus`. */
export const orderStatus = pgEnum("order_status", [
  "pending",
  "confirmed",
  "in_production",
  "ready",
  "completed",
  "cancelled",
  "on_hold",
]);

export const orderPaymentStatus = pgEnum("order_payment_status", [
  "unpaid",
  "deposit_paid",
  "paid",
  "partially_refunded",
  "refunded",
  "failed",
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
    status: orderStatus("status").notNull().default("pending"),
    paymentStatus: orderPaymentStatus("payment_status").notNull().default("unpaid"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone"),
    fulfillmentMethod: fulfillmentMethod("fulfillment_method").notNull(),
    fulfillmentDate: date("fulfillment_date", { mode: "string" }).notNull(),
    /** Optional pickup/delivery window label chosen at checkout, e.g. "10:00–12:00". */
    fulfillmentWindow: text("fulfillment_window"),
    deliveryAddress: jsonb("delivery_address").$type<DeliveryAddress>(),
    notes: text("notes"),
    subtotalCents: integer("subtotal_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    discountCode: text("discount_code"),
    taxCents: integer("tax_cents").notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    /** Tax rate applied, in basis points, recorded for audit. */
    taxRateBps: integer("tax_rate_bps").notNull(),
    /** Deposit that confirms the order (custom orders); 0 means full payment up front. */
    depositCents: integer("deposit_cents").notNull().default(0),
    /** Denormalised from the payments ledger for reporting; the ledger is the source of truth. */
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),
    amountRefundedCents: integer("amount_refunded_cents").notNull().default(0),
    /** sha256 of the token in the customer's order link. */
    accessTokenHash: text("access_token_hash").notNull(),
    sourceInquiryId: uuid("source_inquiry_id"),
    /** Set when created from an accepted quote; unique so a quote can't become two orders. */
    sourceQuoteId: uuid("source_quote_id").unique(),
    /** Status to return to when an order comes off hold. */
    onHoldFrom: text("on_hold_from"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    internalNotes: text("internal_notes"),
    ...timestamps,
  },
  (t) => [
    index("orders_status_idx").on(t.status),
    index("orders_payment_status_idx").on(t.paymentStatus),
    index("orders_fulfillment_date_idx").on(t.fulfillmentDate),
    index("orders_customer_idx").on(t.customerId),
    index("orders_created_idx").on(t.createdAt),
  ],
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

export const paymentKind = pgEnum("payment_kind", ["full", "deposit", "balance", "offline"]);
export const paymentRecordStatus = pgEnum("payment_record_status", ["pending", "succeeded", "failed", "expired"]);

/** One row per attempted or recorded payment. No card data is ever stored. */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    kind: paymentKind("kind").notNull(),
    status: paymentRecordStatus("status").notNull().default("pending"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    /** "stripe", "fake" or "offline". */
    provider: text("provider").notNull(),
    providerSessionId: text("provider_session_id").unique(),
    providerPaymentId: text("provider_payment_id"),
    /** Offline payments: how it was paid (cash, bank transfer…) and why it was recorded. */
    method: text("method"),
    note: text("note"),
    recordedBy: uuid("recorded_by").references(() => adminUsers.id, { onDelete: "set null" }),
    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
    refundedCents: integer("refunded_cents").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("payments_order_idx").on(t.orderId), index("payments_status_idx").on(t.status, t.createdAt)],
);

export const refundStatus = pgEnum("refund_status", ["pending", "succeeded", "failed"]);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    status: refundStatus("status").notNull().default("pending"),
    providerRefundId: text("provider_refund_id").unique(),
    failureReason: text("failure_reason"),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("refunds_order_idx").on(t.orderId)],
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
  "quote_prepared",
  "awaiting_customer",
  "deposit_required",
  "confirmed",
  "declined",
  "expired",
  "cancelled",
  "completed",
]);

export const inquiries = pgTable(
  "inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    status: inquiryStatus("status").notNull().default("new"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone"),
    preferredContact: text("preferred_contact").notNull().default("email"),
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
    internalNotes: text("internal_notes"),
    ...timestamps,
  },
  (t) => [
    index("inquiries_status_idx").on(t.status),
    index("inquiries_created_idx").on(t.createdAt),
    index("inquiries_customer_idx").on(t.customerId),
  ],
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

export const quoteStatus = pgEnum("quote_status", ["draft", "sent", "accepted", "declined", "expired", "withdrawn"]);

/** A priced offer for a custom request. Revisions create a new version; earlier ones are withdrawn. */
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => inquiries.id, { onDelete: "cascade" }),
    reference: text("reference").notNull().unique(),
    version: integer("version").notNull(),
    status: quoteStatus("status").notNull().default("draft"),
    fulfillmentMethod: fulfillmentMethod("fulfillment_method").notNull(),
    fulfillmentDate: date("fulfillment_date", { mode: "string" }).notNull(),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    /** Amount due to confirm; 0 = full payment. */
    depositCents: integer("deposit_cents").notNull().default(0),
    currency: text("currency").notNull().default("usd"),
    /** Production capacity the order will use on its date. */
    capacityUnits: integer("capacity_units").notNull().default(1),
    customerMessage: text("customer_message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("quotes_inquiry_version_idx").on(t.inquiryId, t.version), index("quotes_status_idx").on(t.status)],
);

export const quoteLines = pgTable(
  "quote_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("quote_lines_quote_idx").on(t.quoteId)],
);

/* ------------------------------------------------------------------ */
/* Discounts                                                           */
/* ------------------------------------------------------------------ */

export const discountKind = pgEnum("discount_kind", ["percent", "fixed"]);

export const discounts = pgTable("discounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Upper-cased. */
  code: text("code").notNull().unique(),
  description: text("description"),
  kind: discountKind("kind").notNull(),
  /** percent: basis points (1000 = 10%). fixed: cents. */
  value: integer("value").notNull(),
  minSubtotalCents: integer("min_subtotal_cents").notNull().default(0),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  maxRedemptions: integer("max_redemptions"),
  maxPerCustomer: integer("max_per_customer"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const redemptionStatus = pgEnum("redemption_status", ["pending", "confirmed", "void"]);

export const discountRedemptions = pgTable(
  "discount_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    discountId: uuid("discount_id")
      .notNull()
      .references(() => discounts.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "cascade" }),
    customerEmail: text("customer_email").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: redemptionStatus("status").notNull().default("pending"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("discount_redemptions_discount_idx").on(t.discountId, t.status)],
);

/* ------------------------------------------------------------------ */
/* Production capacity                                                 */
/* ------------------------------------------------------------------ */

export const capacityStatus = pgEnum("capacity_status", ["held", "confirmed", "released"]);

/** Capacity units claimed on a date by an order. Held claims expire unless payment confirms them. */
export const capacityReservations = pgTable(
  "capacity_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date", { mode: "string" }).notNull(),
    units: integer("units").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: capacityStatus("status").notNull().default("held"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("capacity_reservations_date_idx").on(t.date, t.status)],
);

/** Owner-set capacity for a specific date, overriding the daily default. Reason is required and audited. */
export const capacityOverrides = pgTable("capacity_overrides", {
  date: date("date", { mode: "string" }).primaryKey(),
  capacityUnits: integer("capacity_units").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
  ...timestamps,
});

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export const notificationStatus = pgEnum("notification_status", ["pending", "sent", "failed"]);

/**
 * Outbox of emails. Written in the same transaction as the change that causes
 * them; `dedupeKey` makes retried events harmless. Delivered and retried by jobs.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    text: text("text").notNull(),
    html: text("html"),
    replyTo: text("reply_to"),
    status: notificationStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    relatedType: text("related_type"),
    relatedId: text("related_id"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("notifications_due_idx").on(t.status, t.nextAttemptAt), index("notifications_related_idx").on(t.relatedType, t.relatedId)],
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

export const adminRole = pgEnum("admin_role", ["owner", "admin", "order_manager", "production", "reporting"]);

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: adminRole("role").notNull().default("reporting"),
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
/* Inventory and recipe costing                                        */
/* ------------------------------------------------------------------ */

/** Every ingredient is counted in one base unit; quantities are numeric(14,3) in that unit. */
export const baseUnit = pgEnum("base_unit", ["g", "ml", "each"]);
export const stockMovementKind = pgEnum("stock_movement_kind", ["receipt", "usage", "reversal", "adjustment", "waste"]);

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const ingredients = pgTable("ingredients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  unit: baseUnit("unit").notNull(),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  /** Latest known cost in cents per base unit (fractions allowed, e.g. 0.25¢/g). Null = unknown. */
  costPerUnitCents: numeric("cost_per_unit_cents", { precision: 14, scale: 6, mode: "number" }),
  /** Warn when stock on hand falls to or below this. Null = no warning. */
  reorderLevel: numeric("reorder_level", { precision: 14, scale: 3, mode: "number" }),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  ...timestamps,
});

/**
 * The stock ledger. Stock on hand is the sum of `quantity` (signed, base
 * units). Usage and reversal rows reference the order that caused them; the
 * unique index makes consumption idempotent per order and ingredient.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "restrict" }),
    kind: stockMovementKind("kind").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
    /** Cost per base unit at the time (receipts: what was paid; usage: the cost then). */
    unitCostCents: numeric("unit_cost_cents", { precision: 14, scale: 6, mode: "number" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    note: text("note"),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("stock_movements_ingredient_idx").on(t.ingredientId, t.createdAt),
    uniqueIndex("stock_movements_order_idx").on(t.orderId, t.ingredientId, t.kind),
  ],
);

/** One recipe per product. `yieldQuantity` is how many of the product one batch makes. */
export const recipes = pgTable("recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .unique()
    .references(() => products.id, { onDelete: "cascade" }),
  yieldQuantity: numeric("yield_quantity", { precision: 10, scale: 3, mode: "number" }).notNull().default(1),
  notes: text("notes"),
  ...timestamps,
});

export const recipeItems = pgTable(
  "recipe_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "restrict" }),
    /** Base units per batch. */
    quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("recipe_items_recipe_ingredient_idx").on(t.recipeId, t.ingredientId)],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const categoriesRelations = relations(categories, ({ many }) => ({ products: many(products) }));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  images: many(productImages),
  options: many(productOptions),
  collections: many(productCollections),
  recipe: one(recipes, { fields: [products.id], references: [recipes.productId] }),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({ ingredients: many(ingredients) }));

export const ingredientsRelations = relations(ingredients, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [ingredients.supplierId], references: [suppliers.id] }),
  movements: many(stockMovements),
  recipeItems: many(recipeItems),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  ingredient: one(ingredients, { fields: [stockMovements.ingredientId], references: [ingredients.id] }),
  order: one(orders, { fields: [stockMovements.orderId], references: [orders.id] }),
}));

export const recipesRelations = relations(recipes, ({ one, many }) => ({
  product: one(products, { fields: [recipes.productId], references: [products.id] }),
  items: many(recipeItems),
}));

export const recipeItemsRelations = relations(recipeItems, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeItems.recipeId], references: [recipes.id] }),
  ingredient: one(ingredients, { fields: [recipeItems.ingredientId], references: [ingredients.id] }),
}));

export const collectionsRelations = relations(collections, ({ many }) => ({ products: many(productCollections) }));

export const productCollectionsRelations = relations(productCollections, ({ one }) => ({
  product: one(products, { fields: [productCollections.productId], references: [products.id] }),
  collection: one(collections, { fields: [productCollections.collectionId], references: [collections.id] }),
}));

export const customersRelations = relations(customers, ({ many }) => ({ orders: many(orders), inquiries: many(inquiries) }));

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

export const ordersRelations = relations(orders, ({ many, one }) => ({
  items: many(orderItems),
  payments: many(payments),
  refunds: many(refunds),
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  reservation: one(capacityReservations, { fields: [orders.id], references: [capacityReservations.orderId] }),
  redemption: one(discountRedemptions, { fields: [orders.id], references: [discountRedemptions.orderId] }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
  refunds: many(refunds),
}));

export const refundsRelations = relations(refunds, ({ one }) => ({
  payment: one(payments, { fields: [refunds.paymentId], references: [payments.id] }),
  order: one(orders, { fields: [refunds.orderId], references: [orders.id] }),
}));

export const capacityReservationsRelations = relations(capacityReservations, ({ one }) => ({
  order: one(orders, { fields: [capacityReservations.orderId], references: [orders.id] }),
}));

export const discountsRelations = relations(discounts, ({ many }) => ({ redemptions: many(discountRedemptions) }));

export const discountRedemptionsRelations = relations(discountRedemptions, ({ one }) => ({
  discount: one(discounts, { fields: [discountRedemptions.discountId], references: [discounts.id] }),
  order: one(orders, { fields: [discountRedemptions.orderId], references: [orders.id] }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));

export const inquiriesRelations = relations(inquiries, ({ many, one }) => ({
  attachments: many(inquiryAttachments),
  quotes: many(quotes),
  product: one(products, { fields: [inquiries.productId], references: [products.id] }),
  customer: one(customers, { fields: [inquiries.customerId], references: [customers.id] }),
}));

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  inquiry: one(inquiries, { fields: [quotes.inquiryId], references: [inquiries.id] }),
  lines: many(quoteLines),
}));

export const quoteLinesRelations = relations(quoteLines, ({ one }) => ({
  quote: one(quotes, { fields: [quoteLines.quoteId], references: [quotes.id] }),
}));

export const inquiryAttachmentsRelations = relations(inquiryAttachments, ({ one }) => ({
  inquiry: one(inquiries, { fields: [inquiryAttachments.inquiryId], references: [inquiries.id] }),
}));

export const adminSessionsRelations = relations(adminSessions, ({ one }) => ({
  user: one(adminUsers, { fields: [adminSessions.userId], references: [adminUsers.id] }),
}));

