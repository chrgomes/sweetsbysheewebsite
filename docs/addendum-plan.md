# Addendum implementation plan — advanced frontend, backend and bakery operations

_Status: in progress. This document is the single source of truth for the addendum's scope,
decisions and acceptance criteria. Updated as phases land._

## 1. Starting point (what already exists)

| Area | Existing implementation | Gaps against the addendum |
| --- | --- | --- |
| Storefront | Home, shop, categories, product pages, gallery, about, FAQ, contact, policies; brand palette and logo | Collections (seasonal), new arrivals, bestsellers; loading/error boundaries |
| Product options | Select options with price deltas, availability, required/optional | Personalisation text fields (e.g. cake message) with limits and surcharges; admin preview of unpublished products |
| Custom orders | Single-page request form, private uploads, spam protection, reference, emails | Multi-step form with progress, per-step validation, review step, saved progress, preferred contact method, configurable fields |
| Quotes | One "quoted price" field and a one-shot "convert to order" | Quotes with line items, versions, expiry, customer accept/decline page, deposits, balance tracking |
| Orders | One status enum mixing payment and fulfilment (`pending_payment`, `paid`, …) | Separate order status and payment status; `on_hold`; refunds; offline payments; status notifications |
| Payments | Stripe Checkout, signed idempotent webhooks, amount check | Payments/refunds ledger, deposits and balances, refund processing, out-of-order events, missed-webhook recovery |
| Capacity | Lead times, fulfilment weekdays, blackout dates, booking window | Daily capacity, product capacity units, cut-off time, holds with expiry, concurrency-safe booking, calendar, audited overrides |
| Discounts | None | Codes with rules, redemption limits, server-side application |
| Notifications | Direct sends; failures recorded on inquiries only | Outbox with retries, de-duplication, delivery log, branded HTML templates with escaping |
| Jobs | None | Scheduled runner: retry notifications, release holds, expire quotes, recover missed payments |
| Admin roles | `owner` and `staff` | Explicit permission model with five roles enforced server-side |
| Dashboard | Counts and checkout readiness | Sales metrics with documented rules, upcoming pickups, outstanding quotes/deposits, recent activity |
| Customers | Name/email stored per order and request | Customer records linking history, admin view, data erasure |
| Ops | Deployment doc | Runbook (backups, restore, reconciliation, incidents), health check, error hook, privacy notes |

## 2. Architecture decisions

1. **Keep the stack** (Next.js 16, PostgreSQL, Drizzle, Stripe, Resend). It works and is tested; nothing in the addendum needs a new platform.
2. **No customer accounts at launch.** For a small bakery, accounts add password handling, support load and personal-data liability for little benefit. Instead:
   guest checkout; every order, request and quote has an **unguessable signed link**; customers who lose a link use
   **"Find my orders"**, which emails fresh links to the address on file (rate-limited, no account enumeration).
   A `customers` table still groups each person's orders and requests (keyed by email) for staff and for data-erasure requests. Accounts can be added later on top of it.
3. **Cart stays client-side**, priced by the server on every view and at checkout. A database cart adds no protection, since the server re-prices regardless.
4. **One pricing service** (`src/lib/pricing.ts` + `src/lib/money.ts`) used by cart, checkout, quotes, refunds and reports. Integer cents; rounding rule: tax and percentage amounts round half-up to the cent, once per order.
5. **Payments ledger.** A `payments` table (one row per charge: full, deposit, balance, offline) and a `refunds` table. Order `paymentStatus` is derived from the ledger and stored for querying. Order status and payment status are separate enums with validated transitions.
6. **Capacity with database locks.** Each order/quote consumes capacity units on its fulfilment date. Bookings take a PostgreSQL transaction-scoped advisory lock per date, so two simultaneous checkouts can't both claim the last slot. Unpaid checkouts hold capacity until the payment session expires; expired holds stop counting immediately and are cleaned up by the job runner.
7. **Notifications outbox.** Emails are written to a `notifications` table in the same transaction as the business change, with a unique de-duplication key (e.g. `order:123:confirmed`), then sent. Failures retry with backoff (max 5 attempts). Retried webhooks can't send twice.
8. **Jobs without new infrastructure.** `src/lib/jobs.ts` runs idempotent maintenance tasks. Triggered by `POST /api/cron` (secret-protected, for a host scheduler) or `pnpm jobs:run`. No Redis or queue service.
9. **Inventory and recipe costing: Phase 3, not built now.** The addendum makes it optional, and no stock or recipe data exists to build against. Section 6 below records the intended design.

## 3. Owner decisions needed

These have safe defaults (feature off, or "not configured" blocking checkout), so they don't block building or testing:

| Decision | Default until decided |
| --- | --- |
| Payment provider (Stripe recommended) and account | Test/fake provider only |
| Sales-tax treatment and rate | Checkout disabled |
| Pickup/delivery rules, delivery fee and area | Off |
| Lead times (shop minimum, per product), order cut-off time | 48 h minimum, no cut-off |
| Daily production capacity and units per product | Capacity limits off |
| Business hours and closed dates | None shown |
| Deposit policy (percentage, which orders) and balance due date | Deposits off (full payment) |
| Quote validity period | 7 days |
| Cancellation and refund policy wording | No policy page until written |
| Whether to ask customers for a budget | Asked (optional field) |
| Discount codes to offer | None |
| Staff roles to create | Owner only |
| Email provider, sender domain, notification address | Console (no real email) |
| Data-retention period for customer data | Indefinite until set |
| Customer accounts | Not built (see 2.2) |
| Inventory and recipe costing | Not built (Phase 3) |

## 4. Phases and acceptance criteria

### Phase 1 — launch foundation (complete before this addendum; gaps closed here)
- Spelling **Sweets by Shyee** everywhere ✔
- Loading and error states for every route group; not-found pages ✔ (this addendum)
- Branded HTML + text email templates with escaping

### Phase 2 — commerce and operations (this addendum)
| Feature | Acceptance criteria | Tests |
| --- | --- | --- |
| Personalisation fields | Admin can add text options (label, required, max length, surcharge); value appears in cart, order and emails; server rejects over-length/missing values | unit, e2e |
| Collections, new arrivals, bestsellers | Admin manages collections; "New" derived from publish date window; bestsellers computed from paid orders, hidden below a minimum sales threshold | integration |
| Multi-step request form | 5 steps with progress, per-step validation, review screen, progress saved in session storage (files excluded, cleared on submit); server validates everything | e2e |
| Quotes | Line items, tax, delivery, expiry, deposit; versioned; customer accept/decline via signed link; acceptance creates exactly one order; expiry enforced | integration, e2e |
| Order/payment states | Separate enums; transitions validated; payment-dependent transitions only via payments | unit, integration |
| Payments ledger, deposits, balances, refunds, offline payments | Deposit then balance flow; refunds via provider with idempotent webhook; offline payment requires reason; totals reconcile | integration |
| Capacity and calendar | Daily capacity, units per product, cut-off; holds expire; concurrent checkouts for the last slot → exactly one succeeds; admin overrides audited; day/week/month views with conflict warnings | integration (concurrency), e2e |
| Discount codes | Percent/fixed, min subtotal, dates, total and per-customer limits; applied server-side; limits safe under concurrency | unit, integration |
| Notifications outbox and jobs | De-duplicated; retries with backoff; delivery log visible to staff; jobs idempotent | integration |
| Roles and permissions | Owner, Administrator, Order manager, Production, Reporting; every action checks a permission server-side; UI hides what's not allowed | integration, e2e |
| Dashboard and reports | Metrics with documented definitions (`docs/reporting.md`); CSV export behind permission | integration |
| Customers and privacy | Customer history view; erase/anonymise action; "Find my orders" | integration, e2e |
| Ops | `/api/health`, error logging hook, runbook, backup script | — |

### Phase 3 — advanced business management (not started)
Inventory, recipe costing, suppliers, forecasting, CRM, analytics, scheduled reminders beyond deposits. Build only after the owner confirms the need.

## 5. Risks
- **Enum migration** of existing order statuses: done in a hand-written SQL migration with an explicit mapping, tested on a copy of seeded data.
- **Stripe refunds and session recovery** can't be exercised against the real API from this environment (blocked network); covered with signed-event fixtures and the fake provider, and must be verified in Stripe test mode on staging (deployment checklist).
- **Email** can't be sent from this environment; verified through the outbox and memory provider.

## 6. Phase 3 design notes (inventory and recipe costing)
Tables: `ingredients` (base unit: g, ml or each), `unit_conversions`, `suppliers`, `stock_movements` (receipt, usage, adjustment, waste; signed quantity in base units as numeric(14,3); cost per base unit), `recipes` (yield, servings), `recipe_items`. Stock is never reserved at add-to-cart; usage movements are written when an order enters *In production* and reversed on cancellation, inside the same transaction as the status change, keyed by order id so a retry can't double-deduct. Costs and recipes are admin-only and never exposed by public queries.
