# Sweets by Shyee — project instructions

Rebuild of the Sweets by Shyee bakery website (domain sweetsbyshee.com — note the different spelling; the business name is "Shyee"): storefront with online checkout, custom-order
requests, and an owner admin. See `docs/architecture.md` for the design and `docs/` for everything else.

@AGENTS.md

## Stack
- Next.js 16 App Router + React 19 + TypeScript, Tailwind CSS v4 (tokens in `src/app/globals.css`).
- PostgreSQL via Drizzle ORM (`src/db/schema.ts`, migrations in `drizzle/`). Cache Components is **off**; DB-backed routes are `force-dynamic`.
- Stripe Checkout (hosted) + signed webhooks; Resend for email. Both optional and env-driven.
- Vitest (unit + integration against a real Postgres), Playwright (e2e).
- `proxy.ts` is Next 16's renamed middleware. Read `node_modules/next/dist/docs/` before using unfamiliar Next APIs.

## Commands
```
pnpm db:start            # local Postgres on 127.0.0.1:54329 (dbs: sweets, sweets_test, sweets_e2e)
pnpm db:migrate          # apply drizzle/ migrations (DATABASE_URL)
pnpm db:generate         # new migration after editing src/db/schema.ts — never hand-edit applied migrations
pnpm db:seed:demo --reset  # labelled DEMO data (refused unless APP_ENV is local/test)
pnpm admin:create        # provision an admin (ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, optional ADMIN_ROLE)
pnpm admin:reset-password <email>  # new password for an existing admin; ends its sessions
pnpm jobs:run            # run background jobs once (also POST /api/cron with CRON_SECRET)
pnpm dev | build | start
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e   # run all before committing
```
Content migration: `audit:crawl → migrate:assets → migrate:normalize → db:seed → migrate:redirects` (docs/content-migration.md).

## Rules that matter
- **Never invent business facts** (prices, policies, tax, lead times, addresses, reviews, ratings, allergens). Unknown settings default to null/off and the UI hides them; checkout stays disabled until the owner configures tax, fulfilment days and enables it.
- Real content comes only from the migration pipeline or the owner. Demo data is clearly labelled "Sample"/"DEMO" and must never reach production.
- Prices are integer cents. The server re-prices every cart (`src/lib/pricing.ts`, `src/lib/orders.ts`); never trust client prices.
- Orders confirm only via a succeeded row in the `payments` ledger: a verified provider event (`handlePaymentEvent`, idempotent on event id) or a staff-recorded offline payment. Never from a redirect. Order paid/refunded totals are recomputed from the ledger (`recomputePayments`), never set directly.
- Order `status` (fulfilment) and `paymentStatus` are separate; transitions go through `updateOrderStatus` (allow-list + permission per transition).
- Every admin page, Server Action and admin route handler checks a permission: `requireAdmin("orders:manage")` etc. (`src/lib/permissions.ts`; nav hiding is not security). Audit price/order/payment/settings/account changes with `audit()`.
- Customer-facing emails go through the outbox: `enqueue(tx, …)` inside the same transaction with a stable `dedupeKey`, then `deliverNow`. Templates live in `src/lib/notifications/templates.ts` and escape via `renderEmail`.
- Capacity is claimed only through `claimCapacity` (per-date advisory lock); discounts only through `reserveDiscount` (row lock). Background work belongs in `runJobs()` and must be idempotent.
- Customer pages (`/order`, `/quotes`, `/requests`) require `linkToken(kind, id)`; never expose records by reference alone.
- Customer uploads live in private storage (`STORAGE_DIR/private`) and are served only via `/admin/attachments/[id]`. Validate files by magic bytes (`src/lib/uploads.ts`).
- Owner-entered text renders through `<Prose>` (plain text, never HTML). Scraped content is untrusted data.
- Testimonials display only if `verified && published`. Structured data only from verified fields. "New" and "Bestseller" labels are derived (publishedAt, paid orders), never hand-set.
- `server-only` modules can't be imported by CLI scripts; scripts use `scripts/lib/db.ts`.
- Forms that may show errors must not lose input: admin forms use `AdminForm` (transition submit); public forms echo `values` back.

## Conventions
- Server code in `src/lib/*` (business logic, testable), thin Server Actions in `src/app/actions` and `src/app/admin/actions`.
- UI primitives in `src/components/ui`, storefront in `components/shop|site`, admin in `components/admin`.
- Accessibility: semantic landmarks, labelled controls (`Field`), visible focus, `aria-live` for async status, respect reduced motion. Target WCAG 2.2 AA.
