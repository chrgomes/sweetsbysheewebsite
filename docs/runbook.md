# Runbook

Day-to-day procedures for Sweets by Shyee staff and whoever maintains the site. Nothing here needs a
developer unless it says so.

## Every day

1. **Dashboard** — check *Needs attention*: new requests, orders due soon that aren't in production yet,
   quotes waiting on customers and balances due.
2. **Calendar** (day view) — the production sheet for a date: every order, items, options and personalisation
   text, customer notes, and how much of the day's capacity is used. Dashed cards are awaiting payment and
   hold capacity only until their payment window ends.
3. Move orders forward as you work: *In production → Ready → Completed*. Customers are emailed at each step
   unless you untick “Email the customer” (or turn status emails off in Settings).

## Custom requests and quotes

1. Open the request, look at the photos, and set the status to *Reviewing* if you need time.
2. Build the quote: line items, delivery fee, deposit (leave blank to use the default percentage), the
   capacity units it will use, and a message. *Save draft*, check the totals, then *Send to customer*.
   If the date is already full you'll be warned; tick “send anyway” only if you've made room.
3. To change a sent quote, edit the draft that appears and send again — the earlier version is withdrawn
   automatically and its link stops working.
4. When the customer accepts, an order is created and they're asked for the deposit. The date is booked only
   once the deposit is paid. If they decline, their reason appears on the request.
5. Quotes expire after the validity period in Settings; the customer is told and can ask for a new one.

## Payments

- **Online payments** confirm orders automatically. Never mark an order paid because a customer says they paid
  online — check the payment appears on the order (it arrives from Stripe within seconds).
- **Cash or bank transfer**: open the order → *Record a payment received outside the website*. Enter the amount,
  method and a note. This is audited.
- **Balances**: customers get a reminder `balanceDueDaysBefore` days before the date with a link to pay. The
  customer link on the order page lets you resend it yourself.
- **Refunds**: order → Payments → *Refund this payment*. Choose the amount, give a reason and confirm. Card
  refunds go back through Stripe; for cash, return the money first and then record the refund. Only the owner
  and administrators can refund.
- **Cancelling**: choose *Cancelled* with a reason. This frees the date and any discount use and emails the
  customer. It does **not** refund — issue any refund separately.

## Capacity and closures

- Set the normal daily capacity in Settings and each product's *capacity units* on the product page
  (e.g. a tiered cake might use 4, a box of cupcakes 1).
- To close a day or change one day's capacity: Calendar → day → *Capacity for this day*, with a reason.
  Lowering capacity never cancels orders that are already booked.
- For holidays, add dates to *Unavailable dates* in Settings.

## Discounts and collections

- **Discount codes**: percentage or fixed amount, optional minimum order, start/end dates, total uses and uses
  per customer (by email). Codes apply to products only, before delivery and tax. Turn a code off by unticking
  *Active*.
- **Collections**: create one (e.g. “Holiday treats”), optionally with dates and *On homepage*, then tick it on
  each product's page.

## Customers and privacy

- Customers are created automatically from orders and requests (there are no customer passwords). Customers
  can get links to all their orders and requests from *Find my orders* in the site footer.
- **Deletion request**: Customers → the person → *Erase personal data*. Type their email to confirm. Their
  name, contact details, addresses, notes, photos and email copies are removed; amounts stay for your
  accounts. It isn't allowed while they have an open order — complete or cancel it first.
- Exports contain personal data; keep them private and delete them when done.

## Team accounts

Owners manage people in **Team**. Give each person their own account and the least access they need:

| Role | Can |
| --- | --- |
| Owner | Everything, including team accounts |
| Administrator | Everything except team accounts |
| Order manager | Orders, payments (not refunds), requests, quotes, customers, calendar, exports |
| Production staff | See orders and the calendar; move orders through production |
| Read-only / reporting | See orders, requests, calendar and sales figures; export |

When someone leaves, untick *Active* — this signs them out everywhere.

**Forgotten password**: another owner can set a new one in **Team**. If no owner can sign in, the developer runs
`pnpm admin:reset-password you@example.com` against the site's database.

## When something goes wrong

| Symptom | What to do |
| --- | --- |
| An email failed | Admin → System health lists failed emails with the error; fix the cause (e.g. a typo in the address) and press *Retry*. |
| A customer paid but the order still says “Awaiting payment” | Wait a minute and refresh. Then System health → *Run jobs now*, which asks Stripe directly. If it's still pending, check the payment in Stripe and contact the developer — don't record it as an offline payment (that would double-count it). |
| A refund shows “pending” | Stripe hasn't confirmed it yet; it usually settles within minutes. If it's stuck for a day, check it in Stripe. |
| A date shows over capacity | A customer paid after their hold expired. Decide whether you can make it; if not, contact them and cancel/refund. |
| The site shows “Something went wrong” | Note the reference shown on the page and send it to the developer; it matches the server logs. |
| `/api/health` returns 503 | The site can't reach the database. Check the database provider's status page. |

## For the developer

- Deploy steps, environment variables and the launch checklist: [deployment.md](deployment.md).
- Jobs: `POST /api/cron` with `Authorization: Bearer $CRON_SECRET`, or `pnpm jobs:run`, every 5–10 minutes.
- Migrations: back up first, then `pnpm db:migrate`. `0001_operations.sql` converts old order and request
  statuses (mapping in [addendum-plan.md](addendum-plan.md)); verify on a copy of production data before running it
  on the real database.
- Never point tests or `db:seed:demo` at production; the demo seeder and e2e setup refuse non-test databases.
