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

## Reports page (Admin → Reports)

| Metric | Definition |
| --- | --- |
| **Orders confirmed** | Orders whose first successful payment falls in the range, excluding orders later cancelled (unlike the dashboard's "Orders confirmed", which counts them in the period they were confirmed). |
| **Product sales** | Σ order line totals for those orders: unit price including options × quantity, before order-level discounts, tax and delivery. |
| **Items sold / units** | Σ line quantities. |
| **Share** | A product's sales ÷ all product sales in the range. |
| **Est. ingredient cost** | Σ (product's recipe cost per unit × the chosen options' recipe multipliers × quantity), using *current* ingredient costs. "—" when the product has no recipe or an ingredient has no cost. Custom-quote orders are one row and have no cost (their lines are free text). Visible with `costs:view`. |
| **Est. margin** | Sales − est. ingredient cost, and as a % of sales. Excludes labour, packaging and overheads. |
| **Product sales by day** | Product sales grouped by the day of each order's first payment, in the bakery's timezone. |

## Ingredient forecast (Admin → Inventory → Forecast)

Orders due (by pickup/delivery date) in the range that haven't used stock yet: confirmed, and on hold without
having reached production; unpaid orders only when ticked. Needed = Σ quantity × option multipliers ÷ recipe
yield × recipe amounts. *Left after* = in stock − needed. *To buy* = max(0, needed + warn level − in stock), so
stock ends at or above the warn level. Estimated cost uses the last known price.

## What is deliberately not reported

- Unpaid (`pending`) orders are not sales: they become sales only when a payment succeeds.
- Bestsellers on the storefront use paid orders in the last 90 days, with a minimum set in Settings, so a
  handful of test orders can't create a "bestseller".
- Cost of goods on the dashboard. Estimated ingredient costs appear on the Reports page and on each product's
  page (Σ recipe quantity × ingredient cost per unit ÷ batch yield, × option multipliers). Labour, packaging and
  overheads aren't included unless you add them as ingredients.

## Exports

**Orders → Export CSV** downloads the orders matching the current filters (up to 5,000 rows) with customer,
fulfilment, items, totals, paid, refunded and balance columns. Amounts are plain decimals in the currency
column's unit. Exports contain personal data: store them securely and delete them when no longer needed.
Each export is recorded in the activity log.
