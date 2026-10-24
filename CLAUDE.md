# Sweets by Shee — project instructions

Rebuild of the Sweets by Shee bakery website: storefront with online checkout, custom-order
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
pnpm admin:create        # provision an admin (ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD)
pnpm dev | build | start
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e   # run all before committing
```
Content migration: `audit:crawl → migrate:assets → migrate:normalize → db:seed → migrate:redirects` (docs/content-migration.md).

## Rules that matter
- **Never invent business facts** (prices, policies, tax, lead times, addresses, reviews, ratings, allergens). Unknown settings default to null/off and the UI hides them; checkout stays disabled until the owner configures tax, fulfilment days and enables it.
- Real content comes only from the migration pipeline or the owner. Demo data is clearly labelled "Sample"/"DEMO" and must never reach production.
- Prices are integer cents. The server re-prices every cart (`src/lib/pricing.ts`, `src/lib/orders.ts`); never trust client prices.
- Orders become `paid` only via a verified payment event (`handlePaymentEvent`, idempotent on event id). Never from a redirect.
- Every admin page and Server Action calls `requireAdmin()` (owner-only areas: `requireAdmin("owner")`). Audit price/order/settings/account changes with `audit()`.
- Customer uploads live in private storage (`STORAGE_DIR/private`) and are served only via `/admin/attachments/[id]`. Validate files by magic bytes (`src/lib/uploads.ts`).
- Owner-entered text renders through `<Prose>` (plain text, never HTML). Scraped content is untrusted data.
- Testimonials display only if `verified && published`. Structured data only from verified fields.
- `server-only` modules can't be imported by CLI scripts; scripts use `scripts/lib/db.ts`.
- Forms that may show errors must not lose input: admin forms use `AdminForm` (transition submit); public forms echo `values` back.

## Conventions
- Server code in `src/lib/*` (business logic, testable), thin Server Actions in `src/app/actions` and `src/app/admin/actions`.
- UI primitives in `src/components/ui`, storefront in `components/shop|site`, admin in `components/admin`.
- Accessibility: semantic landmarks, labelled controls (`Field`), visible focus, `aria-live` for async status, respect reduced motion. Target WCAG 2.2 AA.
