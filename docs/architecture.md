# Architecture

## Overview

A single Next.js application (frontend, server logic and admin) backed by PostgreSQL. No separate
API service, queue or cache: a small bakery's traffic doesn't justify them.

```
Browser ──► Next.js (App Router, Node runtime)
              ├─ Server Components: pages read the DB directly through src/lib/*
              ├─ Server Actions: cart quote, checkout, custom request, admin mutations
              ├─ Route handlers: /api/webhooks/stripe, /media/[key], /admin/attachments/[id], sitemap, robots
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

`src/db/schema.ts` (all money in integer cents):

- **categories**, **products** (status: draft/active/unavailable/archived; `directPurchase`, `customOrder`,
  lead time, pickup/delivery eligibility, allergens, SEO, `sourceUrl`, `migrationStatus`),
  **product_images**, **product_options** → **product_option_values** (price delta, availability).
- **orders** (reference, status, customer, fulfilment, totals, tax rate snapshot, payment session/intent,
  hashed access token, optional `sourceInquiryId`) → **order_items** (name/options/price snapshots).
- **payment_events** — provider event ids already processed (idempotency).
- **inquiries** (custom requests: event, product type, servings, design, fulfilment, allergies, quote, statuses,
  email delivery status) → **inquiry_attachments** (private storage keys).
- **faqs**, **pages** (about/policies), **gallery_items**, **testimonials** (`verified` + `published`).
- **settings** — one JSON document validated by `siteSettingsSchema` (business details and commerce rules).
- **admin_users** (owner/staff), **admin_sessions** (hashed tokens), **audit_log**, **rate_limits**.

## Ordering flows

### Online checkout

1. The cart lives in `localStorage` and holds only product ids, option-value ids and quantities.
2. The cart page calls `quoteAction`, which loads products from the DB and prices every line
   (`src/lib/pricing.ts`): purchasable status, required options, one value per option, value availability,
   options belonging to the product, quantity limits.
3. `checkoutAction` validates contact and fulfilment details, re-quotes, checks pickup/delivery eligibility
   and the date (`checkFulfillmentDate`: lead time from the strictest product, open weekdays, blackout dates,
   booking window, in the bakery's timezone), computes tax and delivery from settings, saves a
   `pending_payment` order with item snapshots, and creates a hosted checkout session (Stripe idempotency
   key = order id).
4. Stripe redirects back to `/order/[reference]?t=<token>`, which shows "Confirming your payment…" and polls.
5. `POST /api/webhooks/stripe` verifies the signature on the raw body and calls `handlePaymentEvent`, which
   in one transaction records the event id (primary key → duplicates are no-ops) and moves the order
   `pending_payment → paid` only if it is still pending. Amount mismatches are flagged for review.
   Confirmation emails go out once.
6. Admins progress orders (`paid → in_progress → ready → completed`, or cancel/refund) through an allow-list of
   transitions. "Paid" can never be set by hand.

Checkout is available only when `checkoutReadiness()` passes: payment provider configured, tax rate set,
pickup or delivery enabled (with a fee if delivery), fulfilment weekdays chosen, and the owner's switch on.

### Custom-order requests

1. `/custom-orders` renders a form with a signed timestamp token and a honeypot field.
2. `submitInquiry` rejects bots (honeypot, forged/too-fast/expired token), rate-limits per IP (5/hour),
   validates with Zod (conditional delivery address; acknowledgement required), checks the date against
   minimum notice/blackouts, and validates uploads by magic bytes, count and size.
3. `createInquiry` writes files to private storage, inserts the inquiry and attachments in a transaction
   (removing files if the insert fails), then emails the business and the customer. Email failures are
   recorded on the inquiry (`businessEmailStatus`, `customerEmailStatus`) and never lose the request.
4. The customer sees `/custom-orders/thanks?ref=REQ-XXXX-XXXX`.
5. Admins move requests through new → reviewing → quoted → accepted/declined → completed, record a quote and
   notes, and can **convert** an agreed quote into a payable order (agreed price + tax/delivery from settings,
   optional emailed payment link). Conversion is audited and can happen only once.

## Security

- **Validation**: Zod on all inputs; server-side pricing; enumerated status transitions.
- **Auth**: no public sign-up; admins provisioned by CLI or by an owner. Passwords hashed with scrypt
  (N=2¹⁷). Sessions are random 256-bit tokens stored hashed, `HttpOnly`, `SameSite=Lax`, `Secure` in production,
  7-day expiry; deactivating a user or resetting a password revokes sessions. Login is rate-limited per IP and
  per account with constant-time comparison against a dummy hash for unknown emails.
- **Authorisation**: `requireAdmin()` in every admin page and action; owner-only settings, team and activity log.
  `proxy.ts` is an optimisation, not the security boundary.
- **CSRF**: Server Actions enforce same-origin; the only cookie-authenticated route handler is a GET.
- **XSS**: React escaping; CMS and scraped text rendered as plain text; JSON-LD serialised with `<` escaped;
  served uploads use `nosniff` and a sandboxing CSP.
- **Uploads**: content-sniffed, size/count limited, random storage keys, private area outside `public/`,
  admin-only route; owner images re-encoded by sharp (EXIF/GPS stripped).
- **Payments**: hosted checkout (no card data touches the server), webhook signature verification,
  idempotent processing, amount check, order access only with an unguessable token.
- **Headers**: `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy; admin pages `no-store` and `noindex`.
- **Secrets**: server-only environment variables validated at start-up; production refuses the fake payment
  provider, the memory mailer and the default `APP_SECRET`.
- **Rate limiting**: Postgres-backed fixed windows (works across instances); IPs are HMAC-hashed.

## Testing

| Suite | Command | Covers |
| --- | --- | --- |
| Unit | `pnpm test` | money, dates/timezones, pricing rules, upload sniffing, spam tokens, passwords, references, redirects, HTML extraction, robots |
| Integration | `pnpm test` | quoting, order placement, tax/delivery, lead time, readiness gate, webhook idempotency (incl. concurrent duplicates), Stripe signatures, amount mismatch, order access, status transitions, inquiries, email failure handling, conversion, the full migration pipeline against a fixture site |
| E2E | `pnpm test:e2e` | internal links, catalogue and SEO tags, option enforcement, full purchase with payment, failed payment, tampered cart, custom request with upload and file rejection, admin login/authorisation, private attachments, quote → order, product creation with options and photo, settings validation, keyboard skip link, mobile menu, no horizontal scroll |
