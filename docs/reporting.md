# Dashboard metrics

Definitions for the numbers on **Admin → Dashboard** (`src/lib/reports.ts`). Keep this file and the code in
sync. All periods are calendar days in the bakery's timezone (Settings → Timezone). Money is in the shop
currency; nothing is converted. Sales figures are visible to roles with `reports:view` (owner, admin,
reporting).

## Sales (selected period: today, last 7 days, last 30 days, this month)

| Metric | Definition |
| --- | --- |
| **Payments received** | Sum of `payments.amount_cents` with status `succeeded` whose `succeeded_at` falls in the period. Includes deposits, balances and offline payments recorded by staff. Cash basis: counted when the money arrives, not when the order is placed or fulfilled. |
| **Refunded** | Sum of succeeded refunds completed in the period (`refunds.completed_at`). |
| **Net received** | Payments received − refunded, for the period. A refund for an older payment reduces the period in which the refund happened. |
| **Orders confirmed** | Orders whose *first* successful payment falls in the period. An order counts once, in the period it was confirmed, even if its balance is paid later. Cancelled orders still count in the period they were confirmed (their refunds appear under Refunded). |
| **Average order value** | Order total (products − discount + delivery + tax) of orders confirmed in the period ÷ orders confirmed. |
| **Product sales after discounts** | Σ (subtotal − discount) for orders confirmed in the period. Excludes tax and delivery. |
| **Discounts** | Σ discount for orders confirmed in the period. |
| **Tax collected** | Σ tax for orders confirmed in the period, as charged on the order. This is not a tax filing figure; confirm with the accountant. |

## Needs attention (always current)

| Metric | Definition |
| --- | --- |
| **New custom requests** | Requests with status `new`. |
| **Confirmed, due within 3 days** | Orders with status `confirmed` (not yet in production) and a fulfilment date up to 3 days from today. |
| **Quotes awaiting customers** | Quotes with status `sent` (not accepted, declined, withdrawn or expired), and their total value. |
| **Orders with a balance due** | Active or on-hold orders with payment status `deposit_paid`, and the sum of total − paid. |
| **Failed emails / pending refunds** | Outbox messages that gave up after 5 attempts; refunds still waiting for the provider. |
| **Next 7 days** | Confirmed, in-production and ready orders with a fulfilment date from today to 7 days ahead. |

## What is deliberately not reported

- Unpaid (`pending`) orders are not sales: they become sales only when a payment succeeds.
- Bestsellers on the storefront use paid orders in the last 90 days, with a minimum set in Settings, so a
  handful of test orders can't create a "bestseller".
- Cost of goods and margins need ingredient costs and recipes, which aren't modelled yet (see
  `docs/addendum-plan.md`, Phase 3).

## Exports

**Orders → Export CSV** downloads the orders matching the current filters (up to 5,000 rows) with customer,
fulfilment, items, totals, paid, refunded and balance columns. Amounts are plain decimals in the currency
column's unit. Exports contain personal data: store them securely and delete them when no longer needed.
Each export is recorded in the activity log.
