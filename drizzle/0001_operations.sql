-- Operations addendum: payments ledger, quotes, customers, capacity, discounts, notifications, roles.
-- Hand-written: enum changes remap existing data (see docs/addendum-plan.md). New-table DDL is drizzle-kit output.
CREATE TYPE "public"."capacity_status" AS ENUM('held', 'confirmed', 'released');
--> statement-breakpoint
CREATE TYPE "public"."discount_kind" AS ENUM('percent', 'fixed');
--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."option_kind" AS ENUM('choice', 'text');
--> statement-breakpoint
CREATE TYPE "public"."order_payment_status" AS ENUM('unpaid', 'deposit_paid', 'paid', 'partially_refunded', 'refunded', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('full', 'deposit', 'balance', 'offline');
--> statement-breakpoint
CREATE TYPE "public"."payment_record_status" AS ENUM('pending', 'succeeded', 'failed', 'expired');
--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'expired', 'withdrawn');
--> statement-breakpoint
CREATE TYPE "public"."redemption_status" AS ENUM('pending', 'confirmed', 'void');
--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed');
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"internal_notes" text,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product_collections" (
	"product_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_collections_product_id_collection_id_pk" PRIMARY KEY("product_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"status" "payment_record_status" DEFAULT 'pending' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"provider" text NOT NULL,
	"provider_session_id" text,
	"provider_payment_id" text,
	"method" text,
	"note" text,
	"recorded_by" uuid,
	"succeeded_at" timestamp with time zone,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_session_id_unique" UNIQUE("provider_session_id")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"provider_refund_id" text,
	"failure_reason" text,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_provider_refund_id_unique" UNIQUE("provider_refund_id")
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"version" integer NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"fulfillment_method" "fulfillment_method" NOT NULL,
	"fulfillment_date" date NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"delivery_fee_cents" integer DEFAULT 0 NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"capacity_units" integer DEFAULT 1 NOT NULL,
	"customer_message" text,
	"expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"decline_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"kind" "discount_kind" NOT NULL,
	"value" integer NOT NULL,
	"min_subtotal_cents" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"max_redemptions" integer,
	"max_per_customer" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discounts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "discount_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discount_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_email" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "redemption_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_redemptions_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "capacity_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"units" integer NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "capacity_status" DEFAULT 'held' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_reservations_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "capacity_overrides" (
	"date" date PRIMARY KEY NOT NULL,
	"capacity_units" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"text" text NOT NULL,
	"html" text,
	"reply_to" text,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"related_type" text,
	"related_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "capacity_units" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "published_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "products" SET "published_at" = "created_at" WHERE "status" IN ('active', 'unavailable');
--> statement-breakpoint
ALTER TABLE "product_options" ADD COLUMN "kind" "option_kind" DEFAULT 'choice' NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_options" ADD COLUMN "max_length" integer;
--> statement-breakpoint
ALTER TABLE "product_options" ADD COLUMN "price_delta_cents" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_options" ADD COLUMN "help_text" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_status" "order_payment_status" DEFAULT 'unpaid' NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_id" uuid;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment_window" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_cents" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_code" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "deposit_cents" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "amount_paid_cents" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "amount_refunded_cents" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source_quote_id" uuid;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_quote_id_unique" UNIQUE("source_quote_id");
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "on_hold_from" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_reason" text;
--> statement-breakpoint
UPDATE "orders" SET "payment_status" = (CASE "status"::text
  WHEN 'paid' THEN 'paid' WHEN 'in_progress' THEN 'paid' WHEN 'ready' THEN 'paid' WHEN 'completed' THEN 'paid'
  WHEN 'refunded' THEN 'refunded' WHEN 'payment_failed' THEN 'failed' ELSE 'unpaid' END)::"order_payment_status";
--> statement-breakpoint
UPDATE "orders" SET "amount_paid_cents" = "total_cents" WHERE "payment_status" IN ('paid', 'refunded');
--> statement-breakpoint
UPDATE "orders" SET "amount_refunded_cents" = "total_cents" WHERE "payment_status" = 'refunded';
--> statement-breakpoint
INSERT INTO "payments" ("order_id", "kind", "status", "amount_cents", "currency", "provider", "provider_session_id", "provider_payment_id", "succeeded_at", "refunded_cents", "created_at", "updated_at")
SELECT "id", 'full',
  (CASE WHEN "payment_status" IN ('paid', 'refunded') THEN 'succeeded' WHEN "payment_status" = 'failed' THEN 'failed'
        WHEN "status"::text = 'cancelled' THEN 'expired' ELSE 'pending' END)::"payment_record_status",
  "total_cents", "currency", COALESCE("payment_provider", 'unknown'), "payment_session_id", "payment_intent_id", "paid_at",
  (CASE WHEN "payment_status" = 'refunded' THEN "total_cents" ELSE 0 END), "created_at", now()
FROM "orders" WHERE "payment_session_id" IS NOT NULL;
--> statement-breakpoint
ALTER TYPE "public"."order_status" RENAME TO "order_status_old";
--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'confirmed', 'in_production', 'ready', 'completed', 'cancelled', 'on_hold');
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE "public"."order_status" USING (CASE "status"::text
  WHEN 'pending_payment' THEN 'pending' WHEN 'paid' THEN 'confirmed' WHEN 'in_progress' THEN 'in_production'
  WHEN 'ready' THEN 'ready' WHEN 'completed' THEN 'completed' ELSE 'cancelled' END)::"public"."order_status";
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint
DROP TYPE "public"."order_status_old";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_payment_session_id_unique";
--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "payment_session_id";
--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "payment_intent_id";
--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "paid_at";
--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "payment_provider";
--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "confirmation_email_sent_at";
--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "customer_id" uuid;
--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "preferred_contact" text DEFAULT 'email' NOT NULL;
--> statement-breakpoint
ALTER TYPE "public"."inquiry_status" RENAME TO "inquiry_status_old";
--> statement-breakpoint
CREATE TYPE "public"."inquiry_status" AS ENUM('new', 'reviewing', 'quote_prepared', 'awaiting_customer', 'deposit_required', 'confirmed', 'declined', 'expired', 'cancelled', 'completed');
--> statement-breakpoint
ALTER TABLE "inquiries" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "inquiries" ALTER COLUMN "status" SET DATA TYPE "public"."inquiry_status" USING (CASE "status"::text
  WHEN 'new' THEN 'new' WHEN 'reviewing' THEN 'reviewing' WHEN 'quoted' THEN 'awaiting_customer'
  WHEN 'accepted' THEN 'confirmed' WHEN 'declined' THEN 'declined' ELSE 'completed' END)::"public"."inquiry_status";
--> statement-breakpoint
ALTER TABLE "inquiries" ALTER COLUMN "status" SET DEFAULT 'new';
--> statement-breakpoint
DROP TYPE "public"."inquiry_status_old";
--> statement-breakpoint
INSERT INTO "quotes" ("inquiry_id", "reference", "version", "status", "fulfillment_method", "fulfillment_date", "subtotal_cents", "total_cents", "customer_message", "created_at", "updated_at")
SELECT "id", 'QTE-' || upper(substr(md5("id"::text || random()::text), 1, 4)) || '-' || upper(substr(md5(random()::text), 1, 4)), 1,
  (CASE WHEN "converted_order_id" IS NOT NULL THEN 'accepted' ELSE 'draft' END)::"quote_status",
  "fulfillment_method", "event_date", "quoted_price_cents", "quoted_price_cents", "quote_notes", now(), now()
FROM "inquiries" WHERE "quoted_price_cents" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "quote_lines" ("quote_id", "description", "quantity", "unit_price_cents", "line_total_cents")
SELECT q."id", 'Custom order: ' || i."product_type", 1, i."quoted_price_cents", i."quoted_price_cents"
FROM "quotes" q JOIN "inquiries" i ON i."id" = q."inquiry_id";
--> statement-breakpoint
UPDATE "orders" o SET "source_quote_id" = q."id" FROM "quotes" q JOIN "inquiries" i ON i."id" = q."inquiry_id" WHERE i."converted_order_id" = o."id";
--> statement-breakpoint
ALTER TABLE "inquiries" DROP COLUMN "quoted_price_cents";
--> statement-breakpoint
ALTER TABLE "inquiries" DROP COLUMN "quote_notes";
--> statement-breakpoint
ALTER TABLE "inquiries" DROP COLUMN "converted_order_id";
--> statement-breakpoint
ALTER TABLE "inquiries" DROP COLUMN "business_email_status";
--> statement-breakpoint
ALTER TABLE "inquiries" DROP COLUMN "customer_email_status";
--> statement-breakpoint
INSERT INTO "customers" ("email", "name", "phone", "created_at", "updated_at")
SELECT DISTINCT ON (lower("email")) lower("email"), "name", "phone", "created_at", now()
FROM (
  SELECT "customer_email" AS "email", "customer_name" AS "name", "customer_phone" AS "phone", "created_at" FROM "orders"
  UNION ALL
  SELECT "customer_email", "customer_name", "customer_phone", "created_at" FROM "inquiries"
) AS people
ORDER BY lower("email"), "created_at" DESC
ON CONFLICT ("email") DO NOTHING;
--> statement-breakpoint
UPDATE "orders" o SET "customer_id" = c."id" FROM "customers" c WHERE c."email" = lower(o."customer_email");
--> statement-breakpoint
UPDATE "inquiries" i SET "customer_id" = c."id" FROM "customers" c WHERE c."email" = lower(i."customer_email");
--> statement-breakpoint
ALTER TYPE "public"."admin_role" RENAME TO "admin_role_old";
--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('owner', 'admin', 'order_manager', 'production', 'reporting');
--> statement-breakpoint
ALTER TABLE "admin_users" ALTER COLUMN "role" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "admin_users" ALTER COLUMN "role" SET DATA TYPE "public"."admin_role" USING (CASE "role"::text
  WHEN 'owner' THEN 'owner' ELSE 'admin' END)::"public"."admin_role";
--> statement-breakpoint
ALTER TABLE "admin_users" ALTER COLUMN "role" SET DEFAULT 'reporting';
--> statement-breakpoint
DROP TYPE "public"."admin_role_old";
--> statement-breakpoint
ALTER TABLE "capacity_overrides" ADD CONSTRAINT "capacity_overrides_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "capacity_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_admin_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_collections" ADD CONSTRAINT "product_collections_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_collections" ADD CONSTRAINT "product_collections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "capacity_reservations_date_idx" ON "capacity_reservations" USING btree ("date","status");
--> statement-breakpoint
CREATE INDEX "discount_redemptions_discount_idx" ON "discount_redemptions" USING btree ("discount_id","status");
--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("status","next_attempt_at");
--> statement-breakpoint
CREATE INDEX "notifications_related_idx" ON "notifications" USING btree ("related_type","related_id");
--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "product_collections_collection_idx" ON "product_collections" USING btree ("collection_id");
--> statement-breakpoint
CREATE INDEX "quote_lines_quote_idx" ON "quote_lines" USING btree ("quote_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_inquiry_version_idx" ON "quotes" USING btree ("inquiry_id","version");
--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX "inquiries_customer_idx" ON "inquiries" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX "orders_payment_status_idx" ON "orders" USING btree ("payment_status");
--> statement-breakpoint
CREATE INDEX "orders_fulfillment_date_idx" ON "orders" USING btree ("fulfillment_date");
--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");
