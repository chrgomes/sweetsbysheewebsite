# Architecture

## Overview

A single Next.js application (frontend, server logic and admin) backed by PostgreSQL. No separate
API service, queue or cache: a small bakery's traffic doesn't justify them.

```
Browser ──► Next.js (App Router, Node runtime)
              ├─ Server Components: pages read the DB directly through src/lib/*
              ├─ Server Actions: cart quote, checkout, custom request, admin mutations
              ├─ Route handlers: /api/webhooks/stripe, /api/cron, /api/health, /media/[key],
              │                  /admin/attachments/[id], /admin/orders-export, sitemap, robots
              └─ proxy.ts: fast signed-out redirect for /admin, no-store headers
            ├─► PostgreSQL (Drizzle ORM)
            ├─► File storage (STORAGE_DIR: private/ for customer uploads, media/ for owner images)
            ├─► Stripe Checkout (hosted payment page) ◄── signed webhooks
            └─► Resend (transactional email)
```

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16.4, React 19, TypeScript (strict) |
| Styling | Tailwind CSS v4 with design tokens in `globals.css`; self-hosted variable fonts |
| Data | PostgreSQL 16, Drizzle ORM, SQL migrations in `drizzle/` |
| Validation | Zod on every server entry point |
| Payments | Stripe Checkout + webhooks (`PAYMENTS_PROVIDER=stripe`); a dev/test-only fake provider |
| Email | Resend over HTTPS (`EMAIL_PROVIDER=resend`); console/memory providers for dev/tests |
| Tests | Vitest (unit + integration on real Postgres), Playwright (e2e desktop + mobile) |

### Should we use the existing commerce platform instead?

The audit couldn't determine what the current site runs on. If it turns out to be a commerce platform
the owner wants to keep (e.g. Shopify, Square Online), the cleanest options are: keep that platform for
checkout and point "Order online" buttons at it, or import its catalogue with the migration scripts and
retire it. The payment boundary (`src/lib/payments/`) is an interface, so another hosted checkout can
replace Stripe without touching the order logic.

## Rendering and caching

Cache Components (Next 16's default in new apps) is **disabled**. With it on, every route must
prerender at build time, which would require a database during `next build` and non-empty static
params — awkward for a catalogue that is empty until migration and edited live by the owner. Instead
the storefront layout is `force-dynamic` and each request reads current data. With a few dozen products
these queries take milliseconds. If traffic grows, wrap the catalogue reads in `unstable_cache`/`"use cache"`
with tags and call `revalidateTag` from the admin actions.

Lab measurements (production build, 4× CPU slowdown, throttled mobile network; `pnpm audit:perf`):
LCP ≈ 0.5–0.6 s, CLS 0, total blocking time 130–190 ms, ≈ 150 KB gzipped JS per page (framework
baseline; no server libraries in client bundles). Re-measure once real photography is in place, then
check field data in Search Console after launch.

## Data model

`src/db/schema.ts` (all money in integer cents; migrations `drizzle/0000_*` and `0001_operations.sql`):

- **categories**, **collections** (seasonal/themed, optional date window, homepage flag) ↔ **product_collections**,
  **products** (status, `directPurchase`, `customOrder`, lead time, `capacityUnits`, `publishedAt` for “New”,
  pickup/delivery eligibility, allergens, SEO, migration fields), **product_images**,
  **product_options** (`kind` = choice | text; text options have `maxLength`, a surcharge and help text)
  → **product_option_values**.
- **customers** — one row per email (lower-cased), linking a person's orders and requests. No passwords or
  accounts; used for staff lookup and data-erasure requests (`erasedAt`).
- **orders** — reference, `status` (pending, confirmed, in_production, ready, completed, cancelled, on_hold)
  and a separate `paymentStatus` (unpaid, deposit_paid, paid, partially_refunded, refunded, failed), fulfilment
  date + optional window, totals with tax-rate snapshot, discount, deposit, `amountPaidCents`,
  `amountRefundedCents`, `sourceQuoteId` (unique: one order per quote) → **order_items** (snapshots).
- **payments** — the ledger: one row per checkout attempt or recorded offline payment (kind full | deposit |
  balance | offline; status pending | succeeded | failed | expired; provider session/payment ids; refunded
  amount). Order totals paid/refunded are always recomputed from this table. **refunds** (pending | succeeded |
  failed, reason, provider refund id). **payment_events** — provider event ids already processed (idempotency).
- **inquiries** (custom requests, preferred contact, status: new → reviewing → quote_prepared →
  awaiting_customer → deposit_required → confirmed → completed, or declined/expired/cancelled)
  → **inquiry_attachments** (private storage keys) and **quotes** (versioned, draft | sent | accepted | declined |
  expired | withdrawn, expiry, deposit, capacity units) → **quote_lines**.
- **discounts** (percent in basis points or fixed cents, minimum, dates, total and per-customer limits)
  → **discount_redemptions** (pending | confirmed | void; unique per order).
- **capacity_reservations** (units per order and date; held with expiry, or confirmed) and
  **capacity_overrides** (per-day capacity with a required reason).
- **notifications** — email outbox: unique `dedupeKey`, attempts, backoff, last error, related order/request.
- **faqs**, **pages**, **gallery_items**, **testimonials** (`verified` + `published`).
- **suppliers**, **ingredients** (base unit g | ml | each, cost in cents per base unit, reorder level),
  **stock_movements** (the stock ledger: receipt, usage, reversal, adjustment, waste; signed numeric(14,3)
  quantities; usage/reversal rows reference the order, unique per order + ingredient + kind),
  **recipes** (one per product, with a batch yield) → **recipe_items** (base units per batch).
- **settings** — one JSON document validated by `siteSettingsSchema` (business details, commerce rules,
  capacity, cut-off, windows, deposits, quote validity, merchandising thresholds).
- **admin_users** (role: owner | admin | order_manager | production | reporting), **admin_sessions**,
  **audit_log**, **rate_limits**.

## Ordering flows

### Online checkout

1. The cart lives in `localStorage` and holds only product ids, option-value ids, personalisation text and
   quantities. Prices shown anywhere come from the server.
2. `quoteAction` prices every line from the database (`src/lib/pricing.ts`): purchasable status, required
   options, option ownership and availability, text length limits and surcharges, quantity limits, and an
   optional discount code (`src/lib/discounts.ts`). Tax applies to subtotal − discount + delivery.
3. `placeOrder` (in one transaction) re-quotes, validates the date (lead time from the strictest product,
   daily cut-off, weekdays, blackouts, booking window, in the bakery's timezone) and time window, upserts the
   customer, reserves the discount (row lock, so limits hold under concurrency), **holds capacity**
   (`pg_advisory_xact_lock` per date; 65-minute hold), inserts the order, items and a pending payment, then
   creates a hosted checkout session (idempotency key = payment id). If anything fails, it all rolls back.
4. The provider redirects to `/order/[reference]?t=<token>` (an HMAC of the order id), which waits for
   confirmation. **The redirect never marks anything paid.**
5. `POST /api/webhooks/stripe` verifies the signature and calls `handlePaymentEvent`, which records the event id
   (duplicates are no-ops), updates the payment, recomputes the order's payment status, and — on the first
   successful payment — confirms the order, the capacity hold and the discount, and queues emails. Unknown
   sessions return 500 so the provider retries; failed/expired checkouts cancel the unpaid order and release
   its date and code.
6. Missed webhooks are recovered by the `payments` job, which asks the provider about checkouts still pending
   after 15 minutes.

### Custom requests and quotes

1. `/custom-orders` is a five-step form (about you, event, design, fulfilment, review). Each step validates with
   the browser's constraint API before advancing; the server validates everything again. Progress (not photos)
   is kept in `sessionStorage` for that tab only and cleared after sending.
2. `submitInquiry` applies the honeypot, signed timing token, per-IP rate limit, Zod validation, notice period
   and magic-byte upload checks. `createInquiry` stores photos privately, links the customer, and queues the
   acknowledgement and business emails. The customer gets a private status link `/requests/[ref]?t=`.
3. Staff build a **quote** with line items, delivery fee, deposit (default from settings) and capacity units.
   Sending warns if the date is full (override needs a tick), withdraws any earlier sent version, and emails a
   private link `/quotes/[ref]?t=`. Quotes expire after the configured validity.
4. The customer accepts (or declines with an optional reason). Acceptance creates exactly one order
   (`orders.source_quote_id` is unique), holds the date, and starts payment of the deposit or the total. The
   order confirms only when that payment succeeds; the balance can be paid later through the order page or
   recorded by staff, and a reminder is sent `balanceDueDaysBefore` days ahead.

### Order lifecycle

`pending → confirmed → in_production → ready → completed`, with `on_hold` (resumable) and `cancelled`
(reason required; releases capacity and the discount). `pending → confirmed` happens only through a recorded
payment. Completion requires full payment. Production staff may only move orders forward; other changes need
`orders:manage`. Customers are emailed on status changes when `notifyStatusChanges` is on.

### Payments, refunds and offline payments

Staff with `orders:payments` can record money received outside the website (method + note, audited); it can
confirm an order. Staff with `orders:refund` refund all or part of any succeeded payment: provider payments are
refunded through the provider (idempotency key = refund id) and settle from the API response or the refund
webhook, whichever arrives first; offline payments record a manual refund. Totals are recomputed from the
ledger after every change.

### Capacity

Each product has `capacityUnits` (default 1). A day's capacity is `dailyCapacityUnits` or a per-day override.
Held + confirmed units may not exceed it; the check and insert run under a per-date advisory lock, so
concurrent checkouts can't overbook. Expired holds are released by a job (and ignored by the check anyway).
A late payment after a hold expired still confirms the order — the money is taken — and the calendar shows the
day as over capacity for staff to resolve.

### Notifications and jobs

Emails are written to the `notifications` outbox inside the same transaction as the change that causes them,
with a de-duplication key (`order:<id>:confirmed`, …), then delivered immediately after commit. Failures retry
with exponential backoff up to 5 attempts and appear in Admin → System health and on the order/request, with a
retry button. `runJobs()` (payments recovery, hold expiry, quote expiry, balance reminders, email retries,
rate-limit cleanup) is idempotent and runs from `POST /api/cron` (bearer `CRON_SECRET`) or `pnpm jobs:run`.

### Inventory and recipe costing (Phase 3, first half)

Stock on hand is the sum of an ingredient's movements; there's no stored running total to drift. Staff record
deliveries (optionally with what was paid, which sets the ingredient's cost per unit), stocktakes (the count
becomes an adjustment for the difference, with a reason) and waste (with a reason); all are audited. When an
order moves to *In production*, `consumeStockForOrder` writes usage rows inside the status change's transaction:
each line uses quantity ÷ recipe yield batches. The unique (order, ingredient, kind) index makes it idempotent
(hold → resume doesn't deduct twice), and cancelling afterwards writes matching reversal rows. Orders from custom
quotes are skipped because their lines are free text; staff record that usage by hand. Stock may go below zero
(the ledger records what happened); the screens flag it. Recipe cost = Σ(quantity × cost per unit) ÷ yield,
shown with the margin at the base price to roles with `costs:view`. Option choices (e.g. size) don't scale
recipes yet. Not built yet (second half of Phase 3): forecasting/shopping lists, sales analytics, CRM tools,
extra reminders — see `docs/addendum-plan.md`.

### Merchandising

“New” badges and New arrivals come from `publishedAt` (set the first time a product goes active) within
`newArrivalDays`. Bestsellers require at least `bestsellerMinOrders` paid orders in the last 90 days, so they
stay hidden until there is real sales history. Collections show only while active and within their dates.

## Security

- **Validation**: Zod on all inputs; server-side pricing; enumerated status transitions.
- **Auth**: no public sign-up; admins provisioned by CLI or by an owner. Passwords hashed with scrypt
  (N=2¹⁷). Sessions are random 256-bit tokens stored hashed, `HttpOnly`, `SameSite=Lax`, `Secure` in production,
  7-day expiry; deactivating a user or resetting a password revokes sessions. Login is rate-limited per IP and
  per account with constant-time comparison against a dummy hash for unknown emails.
- **Authorisation**: role-based permissions (`src/lib/permissions.ts`). Every admin page, Server Action and admin
  route handler calls `requireAdmin(permission)` / `adminCan(permission)`; navigation is filtered for
  convenience only. Owner: everything. Admin: everything except team accounts. Order manager: orders,
  payments, requests, quotes, customers, calendar. Production: view orders/calendar and move orders forward.
  Reporting: read-only views, reports and exports. `proxy.ts` is an optimisation, not the security boundary.
- **Customer links**: order, request and quote pages require an HMAC token derived from the record id and
  `APP_SECRET` (constant-time compare). “Find my orders” emails fresh links to the address on file and never
  reveals whether an email has orders.
- **Exports**: CSV export requires `orders:export`, is audited, and neutralises spreadsheet formulas.
- **CSRF**: Server Actions enforce same-origin; the only cookie-authenticated route handler is a GET.
- **XSS**: React escaping; CMS and scraped text rendered as plain text; JSON-LD serialised with `<` escaped;
  served uploads use `nosniff` and a sandboxing CSP.
- **Uploads**: content-sniffed, size/count limited, random storage keys, private area outside `public/`,
  admin-only route; owner images re-encoded by sharp (EXIF/GPS stripped).
- **Payments**: hosted checkout (no card data touches the server), webhook signature verification,
  idempotent processing, amount check, provider idempotency keys for checkouts and refunds.
- **Privacy**: customers can be erased on request (Admin → Customers): names, contact details, addresses,
  free text, photos and email copies are removed; amounts stay for accounting. Refused while an order is open.
  Logs never include card data or message bodies; request logging records the path only.
- **Headers**: `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy; admin pages `no-store` and `noindex`.
- **Secrets**: server-only environment variables validated at start-up; production refuses the fake payment
  provider, the memory mailer and the default `APP_SECRET`.
- **Rate limiting**: Postgres-backed fixed windows (works across instances); IPs are HMAC-hashed.

## Testing

| Suite | Command | Covers |
| --- | --- | --- |
| Unit | `pnpm test` | recipe maths (needs, costing, margins, units), money, dates/timezones/cut-off, pricing (options, text surcharges, discounts, rounding), permissions matrix, upload sniffing, spam tokens, passwords, references, redirects, HTML extraction, robots |
| Integration | `pnpm test` | quoting, order placement, tax/delivery/windows, readiness gate, webhook idempotency (concurrent duplicates, out-of-order events, retry for unknown sessions), refunds and offline payments, status transitions and permissions, capacity concurrency (6 racers → 1 wins), hold expiry, overrides, discount limits under concurrency, notification de-dupe/retry/escaping, jobs, quotes (send, versioning, accept → deposit → balance, decline, expiry, full date), customer links, data erasure, merchandising and sales metrics, stock ledger (deliveries/cost, stocktake, waste, low stock), recipe costing, stock use on production with hold/resume idempotency and cancellation reversal, team-member deletion, the migration pipeline |
| E2E | `pnpm test:e2e` | internal links, catalogue/SEO, collections/new arrivals, option enforcement, personalisation and discount pricing, full purchase with payment, failed payment, tampered cart, multi-step request (step validation, saved progress, review, upload rejection), staff quote → customer accepts → deposit → balance → production, product options/collections/draft preview, discount/calendar/export admin, inventory (ingredient, delivery, stocktake, waste, recipe cost and margin), team add/delete, production-role restrictions (stock without costs), signed-out protection, keyboard, mobile layout |
