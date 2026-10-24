# Deployment

Nothing has been deployed. Publishing to production needs the owner's approval and the external
accounts listed in the [launch checklist](#launch-checklist).

## Environments

| | `APP_ENV` | Database | Payments | Email | Indexing |
| --- | --- | --- | --- | --- | --- |
| Local | `local` | local Postgres (`pnpm db:start`) | `fake` | `console` | blocked |
| Automated tests | `test` | `sweets_test` / `sweets_e2e` | `fake` | `memory` / `console` | blocked |
| Staging | `staging` | separate managed DB | `stripe` **test** keys | `resend` (test domain or real) | blocked (robots + `noindex`) |
| Production | `production` | managed DB with backups | `stripe` live keys | `resend`, verified domain | allowed |

All variables are documented in [`.env.example`](../.env.example). Secrets belong in the host's secret
manager, never in the repo. The app validates its environment at start-up and refuses unsafe production
settings (fake payments, memory mailer, default `APP_SECRET`).

## Hosting

Requirements: Node 22, PostgreSQL 14+, and **persistent storage for uploads** (`STORAGE_DIR`).

Recommended: a host with a persistent disk — e.g. Render, Railway or Fly.io (web service + managed
Postgres + mounted volume), or a small VPS with Docker/systemd behind nginx/Caddy.

Serverless hosts (Vercel, Netlify) work for the app itself, but their filesystem is not persistent, so
uploaded inspiration photos and admin-uploaded images would be lost. Before using one, replace the four
functions in `src/lib/storage.ts` with an object store (S3, Cloudflare R2, Vercel Blob); callers only deal
in keys. Migrated images in `public/images/` are part of the build and are fine anywhere.

Build and run:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate          # run once per release, before starting the new version
pnpm start               # PORT defaults to 3000
```

## Database

- Create the database and a least-privilege application user.
- Migrations are SQL files in `drizzle/`, applied with `pnpm db:migrate` (tracked in `__drizzle_migrations`).
  Generate new ones with `pnpm db:generate` after schema changes and review the SQL. Avoid destructive
  changes (dropping/renaming columns) in a single release: add, backfill, then remove later.
- **Take a backup before migrating production.** Never run `db:seed:demo` against staging or production
  (the script refuses unless `APP_ENV` is `local` or `test`).
- Real content: run the migration pipeline and `pnpm db:seed` against the target database
  ([content-migration.md](content-migration.md)), or enter it in the admin.
- First administrator: `ADMIN_EMAIL=… ADMIN_NAME=… pnpm admin:create` (prompts for the password).

## Payments (Stripe)

1. Create/verify the business's Stripe account (business details, bank account, statement descriptor).
2. Staging: set `PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY=sk_test_…`.
3. Add a webhook endpoint `https://<domain>/api/webhooks/stripe` for
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`; set `STRIPE_WEBHOOK_SECRET=whsec_…`.
4. Test with Stripe test cards: success, decline, 3-D Secure, and a resent webhook (should show
   `"outcome":"duplicate"`). Confirm orders turn Paid only after the webhook.
5. Tax: either enter the rate the owner's accountant confirms in **Admin → Settings**, or enable Stripe Tax
   and set `STRIPE_AUTOMATIC_TAX=true`.
6. Production: swap to live keys and a live-mode webhook, place one real low-value order, refund it.

Refunds are issued in the Stripe dashboard; then mark the order Refunded in the admin.

## Email (Resend)

1. Create a Resend account, add and verify the sending domain (SPF/DKIM DNS records).
2. Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on the verified domain, and
   `BUSINESS_NOTIFICATION_EMAIL` (or the contact email in settings).
3. Submit a test custom request and a test order; check both inboxes and spam folders.

Emails sent: order confirmation (customer), new paid order (business), request acknowledgement
(customer), new request (business), quote with optional payment link (customer). Failures are logged and
shown on the request in the admin; nothing is lost.

## Domain, redirects and SEO

- Point DNS at the host, enable HTTPS, set `NEXT_PUBLIC_SITE_URL=https://<domain>` (no trailing slash).
- Decide on `www` vs. apex and redirect the other at the host/DNS level.
- `data/redirects.json` (from `pnpm migrate:redirects`, reviewed by hand) is applied at build time as
  permanent redirects. Check `data/url-map.csv` for unmatched old URLs.
- After launch: submit `https://<domain>/sitemap.xml` in Google Search Console, watch coverage and 404s
  for a few weeks, and check Core Web Vitals field data.

## Operations

- Logs are single-line JSON on stdout/stderr (`order.created`, `payment.event`, `inquiry.created`,
  `email.failed`, `stripe.webhook_rejected`, …). Alert on `email.failed`, `order.amount_mismatch`,
  `stripe.webhook_failed`.
- Back up the database daily and `STORAGE_DIR` (customer uploads).
- Customer data: orders and requests contain names, emails, phones and addresses. Agree a retention period
  with the owner and publish a privacy policy page (Admin → Site content → About & policies).

## CI

`.github/workflows/ci.yml` runs lint, typecheck, unit/integration tests against a Postgres service,
the production build and the Playwright suite on every push and pull request.

## Launch checklist

Owner decisions and content
- [ ] Run the content migration (needs network access to sweetsbyshee.com) or supply content directly
- [ ] Review every migrated product: price, options, photos, allergens, lead time, ordering route; mark verified
- [ ] Confirm which products can be bought online and which are custom-only
- [ ] Business details: name, tagline, story, contact email/phone, service area, hours, social links, whether to show an address
- [ ] Commerce rules: sales-tax rate (with accountant), pickup instructions, delivery area and fee, minimum notice, fulfilment days, blackout dates, booking window
- [ ] Policies: refunds/cancellations, allergens, delivery, privacy
- [ ] FAQs, gallery photos (alt text), genuine testimonials (marked verified)
- [ ] Remove or replace all demo/"Sample" data on any shared database

External accounts and credentials
- [ ] Hosting with persistent storage (or object-storage adapter), managed PostgreSQL with backups
- [ ] Stripe account, keys and webhook (test, then live)
- [ ] Resend account with verified sending domain
- [ ] Domain DNS and HTTPS
- [ ] Strong `APP_SECRET`, first owner account via `pnpm admin:create`

Verification
- [ ] `pnpm check` and `pnpm test:e2e` green on the release commit
- [ ] Staging: test-card purchase, declined card, duplicate webhook, custom request with photo, emails received
- [ ] Redirects from old URLs return 308 to the right pages
- [ ] Lighthouse/`pnpm audit:perf` with real photography; Search Console set up after launch
- [ ] Switch on **Accept online orders** in settings only after all of the above
