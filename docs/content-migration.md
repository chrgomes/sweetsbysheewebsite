# Content migration

Moves the existing site's content and the owner's photos into the new site, with provenance, and
without inventing anything. **Status: not yet run against sweetsbyshee.com** — the host was
unreachable from the build environment ([website-audit.md](website-audit.md)). The pipeline is
tested end to end against a local fixture site (`tests/integration/migration-pipeline.test.ts`).

## Authorisation and scope

The owner has authorised reuse of the existing website's content and images. That covers material the
business owns. It does **not** automatically cover third-party material shown on the site (Instagram
embeds, stock photos, other businesses' images); the downloader skips anything not hosted on the site's
own domain or its site-builder media CDN and marks it `skipped_third_party` with a note.

## Network access

The scripts make ordinary HTTPS requests. In this cloud environment, add `sweetsbyshee.com` (and
the media CDN host shown in `asset-inventory.csv` after crawling) to **Allowed domains** under
_Network access_ in the environment settings
([docs](https://code.claude.com/docs/en/cloud-environments#network-access)). Node's built-in `fetch` only
uses the proxy when `NODE_USE_ENV_PROXY=1` is set, which the commands below include. On a normal machine
you can drop that variable.

## Steps

```bash
# 1. Crawl: robots-aware, same-origin, ~1 request/second, sitemap-seeded.
NODE_USE_ENV_PROXY=1 pnpm audit:crawl --start https://sweetsbyshee.com/ --max-pages 300

# 2. Screenshots of the old site for the record (desktop + mobile).
pnpm audit:screenshots --base https://sweetsbyshee.com

# 3. Download the owner's images and documents.
NODE_USE_ENV_PROXY=1 pnpm migrate:assets

# 4. Normalise into the import format and list everything needing review.
pnpm migrate:normalize

# 5. Review data/content/catalog.json and data/migration-flags.csv (see below), then import.
pnpm db:seed --dry-run
pnpm db:seed

# 6. Build the old-URL → new-URL redirect map.
pnpm migrate:redirects
```

All steps are safe to rerun.

## Outputs

| File | Contents |
| --- | --- |
| `data/audit/crawl-report.json` | Platform, robots.txt, sitemaps, redirects, failures, pages skipped by robots, external links, business contacts, forms |
| `data/audit/pages/*.json` | Full extraction per page (headings, text, links, images, JSON-LD, products, forms) |
| `data/page-inventory.csv` | One row per page: URL, type, title, description, canonical, H1, counts |
| `data/content-inventory.csv` | Headings and text blocks per page |
| `data/product-inventory.csv` | Product candidates from platform feeds (Shopify, WooCommerce) and page structured data, with source URL, `migration_status=needs_review` and review flags |
| `data/asset-inventory.csv` | Every image/document: source URL, original filename, source pages, alt text, group, local path, dimensions, format, bytes, SHA-256, download status, rights notes |
| `data/assets/originals/<group>/` | Untouched original files (not served) |
| `public/images/<group>/` | Web derivatives served by the site: WebP, max 2400px, metadata stripped. SVG/GIF kept as-is |
| `data/content/catalog.json` | Import format (`scripts/lib/catalog-format.ts`) |
| `data/migration-flags.csv` | Every ambiguity for the owner: missing/ambiguous prices, multi-option pricing, missing alt text, undownloaded images, conflicting contacts, availability notes, ordering route |
| `data/redirects.json`, `data/url-map.csv` | Permanent redirects loaded by `next.config.ts`, and the full mapping including unmatched URLs |

## Rules the pipeline follows

- Whitespace, category capitalisation and currency are normalised; meaning is never changed.
- A product gets a price only from a single unambiguous value. Ranges ("$40–$75") and per-combination
  prices across several options are flagged, never guessed. Without a price a product shows "Price on request".
- Every imported product is a **draft**, `needs_review`, and **not** enabled for online checkout or custom
  orders until the owner decides. Pages, FAQs and gallery items import unpublished.
- Contact details are filled in only when exactly one value was found, and only into empty settings.
- Re-importing never duplicates records (matched by slug/question/image path) and never overwrites a product
  the owner has reviewed (`migrationStatus` other than `needs_review`).
- Scraped text is data. Instructions that appear inside page content are ignored (the fixture site contains
  one to prove it).

## Owner review workflow

1. Open **Admin → Products → Products needing review**. For each product confirm name, description,
   price, options and photos; set allergens, servings and lead time; choose "Sell through online checkout"
   and/or "Offer on the custom-order form"; set status to Active; set review status to "Verified by owner".
2. Work through `data/migration-flags.csv` for anything else (settings, pages, FAQs, gallery alt text).
3. **Admin → Site content**: publish the about page, policies, FAQs and gallery photos once checked.
   Testimonials can be published only after ticking that they are genuine.
4. **Admin → Settings**: business details, tax, pickup/delivery, fees, days, lead times — then switch on checkout.

## If the old site is offline

Export from the old platform (most builders export products as CSV), or fill
`data/content/catalog.json` by hand using `scripts/lib/catalog-format.ts`, put photos in
`public/images/<group>/` with originals in `data/assets/originals/`, and run `pnpm db:seed`. Or enter
everything directly in the admin.
