# Website audit — sweetsbyshee.com

_Last updated: 24 October 2026_

## Summary

**The source website could not be inspected from the build environment, so no content, prices,
policies or images have been migrated yet.** Nothing on the new site describes the real business;
the only catalogue data present is a clearly labelled demo set used for development and testing.

Everything needed to complete the audit is built and tested: a robots-aware crawler, an asset
downloader, a normaliser that flags ambiguities, an idempotent importer and a redirect builder
(see [content-migration.md](content-migration.md)). Running them takes one command sequence once
the site is reachable.

## What was attempted

Full log: [`data/audit/crawl-attempts.json`](../data/audit/crawl-attempts.json).

| Method | Target | Result |
| --- | --- | --- |
| `curl` through the session's egress proxy | `https://sweetsbyshee.com/`, `www.`, `/robots.txt`, `/sitemap.xml` | **Blocked** — proxy returned `403` (host not on this environment's network allow-list) |
| Web fetch tool | `sweetsbyshee.com`, `www.sweetsbyshee.com` | DNS failure (`ENOTFOUND`). The same tool also failed for `example.com`, so this is a tool limitation and **not** evidence the domain is down |
| Internet Archive | snapshot index for the domain | Unavailable from this environment |
| Web search | the domain, "Sweets by Shee" (the business name was later confirmed as "Sweets by Shyee"), likely social handles | No indexed pages for the domain or business. Results were unrelated bakeries with similar names; **none of their content was used** |
| `pnpm audit:crawl` | `https://sweetsbyshee.com/` | Blocked by the proxy; crawler exited cleanly (code 2) |

Because nothing could be fetched, this audit cannot state how many pages the site has, which
platform it runs on, what the product range or prices are, or whether ordering is currently online.
**Coverage: 0 pages verified.**

## How to complete the audit

1. Make the site reachable from wherever the scripts run — either
   - add `sweetsbyshee.com` (and its media CDN, once known) to this cloud environment's
     **Allowed domains** under _Network access_ ([docs](https://code.claude.com/docs/en/cloud-environments#network-access)), or
   - run the scripts on any machine with normal internet access.
2. Run the pipeline (details in [content-migration.md](content-migration.md)):
   ```bash
   NODE_USE_ENV_PROXY=1 pnpm audit:crawl --start https://sweetsbyshee.com/
   pnpm audit:screenshots                     # desktop + mobile captures of the old site
   NODE_USE_ENV_PROXY=1 pnpm migrate:assets
   pnpm migrate:normalize                      # writes data/migration-flags.csv
   pnpm db:seed && pnpm migrate:redirects
   ```
3. Fill in the sections below from `data/audit/crawl-report.json`, the inventories in `data/`,
   and the screenshots, then work through `data/migration-flags.csv` with the owner.

If the old site is already offline, the owner can supply content directly: export from the old
platform (most builders offer product CSV/JSON export), or fill `data/content/catalog.json` by
hand using the format in `scripts/lib/catalog-format.ts`, and put photos in `data/assets/originals/`.

## Audit checklist (to complete after crawling)

The crawler records each of these automatically; the right-hand column says where.

| Area | What to record | Source |
| --- | --- | --- |
| Platform | Site builder / commerce platform, and whether it already handles orders and payments (if so, evaluate integrating rather than replacing — see architecture.md) | `crawl-report.json → platform`, product feeds |
| Pages | Every public URL, type, title, description, H1, canonical | `data/page-inventory.csv` |
| Content | Headings and text per page | `data/content-inventory.csv` |
| Products | Name, category, price(s), options/variants, description, images, availability | `data/product-inventory.csv` |
| Assets | Every image/document with source page, dimensions, hash, download status, rights notes | `data/asset-inventory.csv` |
| Business facts | Emails, phones, social links, address, service area, hours | `crawl-report.json → business` |
| Ordering | Lead times, pickup/delivery rules, fees, deposits, cancellation policy | policy/FAQ pages in the content inventory |
| Allergens | Allergen and ingredient statements | product pages, FAQ |
| Forms | Existing inquiry/contact forms and their fields (not submitted) | `crawl-report.json → business.forms` |
| SEO | Titles, descriptions, URL structure, redirects, robots rules, sitemap | page inventory, `crawl-report.json` |
| Third-party content | Embeds (Instagram, stock photos) not owned by the business | assets with `skipped_third_party` |
| Gaps | Pages blocked by robots, failures, page limit | `crawl-report.json` |

## Customer-experience review

A design and UX review of the existing site needs the screenshots from step 2. The new site
was designed to avoid the problems most common on small-bakery sites — unclear ordering route
(buy now vs. custom request), prices hidden in images, no lead-time guidance, inquiry forms that
read like confirmed bookings, slow image-heavy pages and weak mobile layouts — but **whether the
current site has these problems has not been verified**.

## Feature inventory of the new site

Implemented and covered by automated tests:

- Catalogue with categories, product options/variants with price deltas, availability states, image galleries with graceful fallback.
- Two ordering routes: online checkout for products the owner enables, and a custom-order request flow.
- Cart priced by the server; checkout with pickup/delivery, lead-time and calendar rules, tax and delivery fee from settings; hosted payment (Stripe) with signed, idempotent webhooks; order status page.
- Custom-order requests with conditional fields, private inspiration uploads, spam protection, confirmation reference, owner and customer emails, status workflow, quote and conversion to a payable order.
- Admin: dashboard, orders, requests, products/options/photos, categories, FAQs, pages/policies, gallery, testimonials (verified only), settings, team roles, activity log.
- SEO: per-page metadata, canonical URLs, sitemap, robots, JSON-LD (organisation, product, breadcrumbs, FAQ) from verified fields only, redirect map support.

Remaining owner inputs and external setup are listed in [deployment.md](deployment.md#launch-checklist).
