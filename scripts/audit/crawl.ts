/**
 * Audit crawler for the existing website.
 *
 *   NODE_USE_ENV_PROXY=1 pnpm audit:crawl --start https://sweetsbyshee.com/ [--max-pages 300] [--delay 1200]
 *
 * - Obeys robots.txt and only fetches same-origin HTML pages.
 * - Seeds from the homepage, sitemap(s) and platform product feeds.
 * - One request at a time with a polite delay; identifies itself.
 * - Writes structured results to data/ (see docs/content-migration.md).
 * - Scraped content is data only: nothing in it is executed or obeyed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { writeCsv } from "../lib/csv";
import { ASSET_HEADERS, CONTENT_HEADERS, PAGE_HEADERS, PRODUCT_HEADERS } from "../lib/inventory";
import { clean, extractPage, normalizeUrl, robotsAllows, sitemapUrls, type PageExtract, type ProductCandidate } from "../lib/extract";

const { values: args } = parseArgs({
  options: {
    start: { type: "string", default: "https://sweetsbyshee.com/" },
    "max-pages": { type: "string", default: "300" },
    delay: { type: "string", default: "1200" },
    out: { type: "string", default: "data" },
  },
  allowPositionals: true,
});

const UA = "SweetsBySheeSiteMigration/1.0 (authorized by site owner; site rebuild audit)";
const start = new URL(args.start!);
const origin = start.origin;
const maxPages = Number(args["max-pages"]);
const delayMs = Number(args.delay);
const outDir = path.resolve(args.out!);
const auditDir = path.join(outDir, "audit");
mkdirSync(path.join(auditDir, "pages"), { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FetchResult = { url: string; status: number; contentType: string; body: string; finalUrl: string; error?: string };

async function get(url: string, accept = "text/html,application/xhtml+xml"): Promise<FetchResult> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const contentType = res.headers.get("content-type") ?? "";
    const body = /text|json|xml/.test(contentType) ? await res.text() : "";
    return { url, status: res.status, contentType, body, finalUrl: res.url };
  } catch (err) {
    return { url, status: 0, contentType: "", body: "", finalUrl: url, error: String((err as Error)?.cause ?? err) };
  }
}

const report = {
  startedAt: new Date().toISOString(),
  origin,
  robotsTxt: null as string | null,
  sitemaps: [] as string[],
  platform: null as string | null,
  crawled: 0,
  skippedByRobots: [] as string[],
  failures: [] as { url: string; status: number; error?: string }[],
  redirects: [] as { from: string; to: string }[],
  externalLinks: new Set<string>(),
  feedProducts: 0,
  limitReached: false,
  finishedAt: "",
};

// robots.txt
const robots = await get(`${origin}/robots.txt`, "text/plain");
if (robots.status === 0) {
  console.error(`Could not reach ${origin}: ${robots.error}`);
  console.error("Check network access (see docs/content-migration.md#network-access) and try again.");
  process.exit(2);
}
report.robotsTxt = robots.status === 200 ? robots.body : null;
const allowed = (u: string) => !report.robotsTxt || robotsAllows(report.robotsTxt, new URL(u).pathname + new URL(u).search, "*");

const queue: string[] = [normalizeUrl(start.toString(), origin)!];
const seen = new Set<string>(queue);
const enqueue = (u: string | null) => {
  if (!u) return;
  const url = new URL(u);
  if (url.origin !== origin) return;
  if (/\.(jpe?g|png|gif|webp|svg|avif|pdf|zip|mp4|mov|css|js|ico|woff2?)$/i.test(url.pathname)) return;
  if (/\/(cart|checkout|account|login|logout|cdn-cgi)(\/|$)/i.test(url.pathname)) return;
  if (seen.has(u)) return;
  seen.add(u);
  queue.push(u);
};

// Seed queue from sitemaps.
const sitemapQueue = [...(report.robotsTxt?.match(/^sitemap:\s*(\S+)/gim) ?? []).map((l) => l.replace(/^sitemap:\s*/i, "")), `${origin}/sitemap.xml`];
const doneSitemaps = new Set<string>();
while (sitemapQueue.length) {
  const sm = sitemapQueue.shift()!;
  if (doneSitemaps.has(sm) || doneSitemaps.size > 50) continue;
  doneSitemaps.add(sm);
  const res = await get(sm, "application/xml,text/xml");
  await sleep(delayMs);
  if (res.status !== 200) continue;
  report.sitemaps.push(sm);
  const { pages, sitemaps } = sitemapUrls(res.body);
  sitemapQueue.push(...sitemaps);
  pages.forEach((p) => enqueue(normalizeUrl(p, origin)));
}

// Crawl.
const pages: (PageExtract & { status: number; fetchedAt: string })[] = [];
while (queue.length) {
  if (pages.length >= maxPages) {
    report.limitReached = true;
    break;
  }
  const url = queue.shift()!;
  if (!allowed(url)) {
    report.skippedByRobots.push(url);
    continue;
  }
  const res = await get(url);
  await sleep(delayMs);
  if (res.finalUrl !== url) report.redirects.push({ from: url, to: res.finalUrl });
  if (res.status !== 200 || !/html/.test(res.contentType)) {
    report.failures.push({ url, status: res.status, error: res.error ?? (res.status === 200 ? `non-HTML: ${res.contentType}` : undefined) });
    continue;
  }
  const final = normalizeUrl(res.finalUrl, origin) ?? url;
  if (new URL(final).origin !== origin || pages.some((p) => p.url === final)) continue;
  const page = { ...extractPage(res.body, final, origin), status: res.status, fetchedAt: new Date().toISOString() };
  pages.push(page);
  report.platform ??= page.platform;
  const slug = new URL(final).pathname.replace(/^\/|\/$/g, "").replace(/[^a-z0-9]+/gi, "_") || "home";
  writeFileSync(path.join(auditDir, "pages", `${slug}.json`), JSON.stringify(page, null, 2));
  for (const l of page.links) {
    if (l.internal) enqueue(l.href);
    else report.externalLinks.add(l.href);
  }
  console.log(`[${pages.length}] ${res.status} ${page.pageType.padEnd(14)} ${final}`);
}

// Platform product feeds give structured prices and variants where available.
type FeedProduct = ProductCandidate & { sourceUrl: string; options: { name: string; values: string[] }[]; variants: { title: string; price: number | null; available: boolean | null }[] };
const feed: FeedProduct[] = [];
const stripTags = (h: string | null | undefined) => clean((h ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&"));
if (report.platform === "shopify") {
  for (let n = 1; n <= 20; n++) {
    const res = await get(`${origin}/products.json?limit=250&page=${n}`, "application/json");
    await sleep(delayMs);
    if (res.status !== 200) break;
    const data = JSON.parse(res.body) as {
      products: { title: string; handle: string; body_html: string; product_type: string; images: { src: string }[]; options: { name: string; values: string[] }[]; variants: { title: string; price: string; available: boolean; sku: string }[] }[];
    };
    if (!data.products?.length) break;
    for (const p of data.products) {
      feed.push({
        name: clean(p.title),
        description: stripTags(p.body_html) || null,
        priceText: p.variants.map((v) => v.price).join(" / "),
        price: new Set(p.variants.map((v) => v.price)).size === 1 ? Number(p.variants[0].price) : null,
        currency: null,
        availability: p.variants.some((v) => v.available) ? "InStock" : "OutOfStock",
        images: p.images.map((i) => i.src),
        sku: p.variants[0]?.sku || null,
        category: p.product_type || null,
        source: "json-ld",
        sourceUrl: `${origin}/products/${p.handle}`,
        options: p.options.filter((o) => !(o.name === "Title" && o.values[0] === "Default Title")),
        variants: p.variants.map((v) => ({ title: v.title, price: Number(v.price), available: v.available })),
      });
    }
  }
} else if (report.platform === "woocommerce" || report.platform === "wordpress") {
  const res = await get(`${origin}/wp-json/wc/store/v1/products?per_page=100`, "application/json");
  if (res.status === 200) {
    const items = JSON.parse(res.body) as {
      name: string;
      permalink: string;
      description: string;
      prices: { price: string; currency_code: string; currency_minor_unit: number };
      images: { src: string }[];
      categories: { name: string }[];
      is_in_stock: boolean;
      attributes: { name: string; terms: { name: string }[] }[];
    }[];
    for (const p of items) {
      const minor = 10 ** (p.prices?.currency_minor_unit ?? 2);
      feed.push({
        name: clean(p.name),
        description: stripTags(p.description) || null,
        priceText: p.prices?.price ?? null,
        price: p.prices?.price ? Number(p.prices.price) / minor : null,
        currency: p.prices?.currency_code ?? null,
        availability: p.is_in_stock ? "InStock" : "OutOfStock",
        images: p.images.map((i) => i.src),
        sku: null,
        category: p.categories[0]?.name ?? null,
        source: "json-ld",
        sourceUrl: p.permalink,
        options: p.attributes.map((a) => ({ name: a.name, values: a.terms.map((t) => t.name) })),
        variants: [],
      });
    }
  }
}
report.feedProducts = feed.length;

// Merge product candidates: platform feed first, then page-level structured data.
type Row = Record<string, unknown>;
const products = new Map<string, Row>();
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
for (const p of feed) products.set(key(p.name), { ...p, options: JSON.stringify(p.options), variants: JSON.stringify(p.variants) });
for (const page of pages) {
  for (const p of page.products) {
    const existing = products.get(key(p.name));
    if (existing) existing.sourcePages = [...new Set([...((existing.sourcePages as string[]) ?? []), page.url])];
    else products.set(key(p.name), { ...p, sourceUrl: page.url, sourcePages: [page.url], options: "[]", variants: "[]" });
  }
}

const productRows = [...products.values()].map((p) => ({
  name: p.name,
  category: p.category ?? "",
  price: p.price ?? "",
  price_text: p.priceText ?? "",
  currency: p.currency ?? "",
  availability: p.availability ?? "",
  description: p.description ?? "",
  options_json: p.options,
  variants_json: p.variants,
  image_urls: p.images,
  extraction_source: p.source,
  source_url: p.sourceUrl,
  migration_status: "needs_review",
  review_flags: [p.price === null || p.price === "" ? "price-missing-or-ambiguous" : "", !p.description ? "no-description" : "", !(p.images as string[])?.length ? "no-images" : ""].filter(Boolean),
}));

// Asset inventory: every image or document referenced by a crawled page.
const assets = new Map<string, Row>();
for (const page of pages) {
  for (const img of page.images) {
    const a = assets.get(img.url);
    if (a) {
      a.source_pages = [...new Set([...(a.source_pages as string[]), page.url])];
      if (!a.alt && img.alt) a.alt = img.alt;
      continue;
    }
    assets.set(img.url, {
      source_url: img.url,
      original_filename: decodeURIComponent(new URL(img.url).pathname.split("/").pop() ?? ""),
      source_pages: [page.url],
      context: img.context,
      alt: img.alt,
      host: new URL(img.url).hostname,
      associated_product: page.products[0]?.name ?? "",
      suggested_group: page.products.length ? "products" : img.context === "link" ? "brand" : page.pageType === "home" && img.context !== "img" ? "banners" : "gallery",
      download_status: "pending",
    });
  }
}
for (const doc of new Set(pages.flatMap((p) => p.documents))) {
  assets.set(doc, {
    source_url: doc,
    original_filename: decodeURIComponent(new URL(doc).pathname.split("/").pop() ?? ""),
    source_pages: pages.filter((p) => p.documents.includes(doc)).map((p) => p.url),
    context: "document",
    host: new URL(doc).hostname,
    suggested_group: "documents",
    download_status: "pending",
  });
}

// Outputs.
writeCsv(
  path.join(outDir, "page-inventory.csv"),
  PAGE_HEADERS,
  pages.map((p) => ({ url: p.url, status: p.status, page_type: p.pageType, title: p.title, meta_description: p.metaDescription, canonical: p.canonical, h1: p.headings.find((h) => h.level === 1)?.text ?? "", word_count: p.wordCount, images: p.images.length, products: p.products.length, forms: p.forms.length, robots_meta: p.robots })),
);
writeCsv(
  path.join(outDir, "content-inventory.csv"),
  CONTENT_HEADERS,
  pages.flatMap((p) => [
    ...p.headings.map((h, i) => ({ url: p.url, page_type: p.pageType, kind: `h${h.level}`, order: i, text: h.text })),
    ...p.textBlocks.map((t, i) => ({ url: p.url, page_type: p.pageType, kind: "text", order: i, text: t })),
  ]),
);
writeCsv(path.join(outDir, "product-inventory.csv"), PRODUCT_HEADERS, productRows);
writeCsv(path.join(outDir, "asset-inventory.csv"), ASSET_HEADERS, [...assets.values()]);

const business = {
  emails: [...new Set(pages.flatMap((p) => p.emails))],
  phones: [...new Set(pages.flatMap((p) => p.phones))],
  socialLinks: [...new Set(pages.flatMap((p) => p.socialLinks))],
  forms: pages.filter((p) => p.forms.length).map((p) => ({ url: p.url, forms: p.forms })),
};
report.finishedAt = new Date().toISOString();
report.crawled = pages.length;
writeFileSync(path.join(auditDir, "crawl-report.json"), JSON.stringify({ ...report, externalLinks: [...report.externalLinks].sort(), business, unvisitedQueue: queue }, null, 2));
console.log(`\nCrawled ${pages.length} pages, ${productRows.length} product candidates, ${assets.size} assets. Platform: ${report.platform ?? "unknown"}.`);
console.log(`Skipped by robots.txt: ${report.skippedByRobots.length}. Failures: ${report.failures.length}.${report.limitReached ? " Page limit reached — rerun with a higher --max-pages." : ""}`);
