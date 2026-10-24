/**
 * Build data/content/catalog.json (the import format) from the audit
 * inventories, and data/migration-flags.csv listing everything the owner
 * must confirm.
 *
 *   pnpm migrate:normalize
 *
 * Rules: normalise whitespace, currency and category names; never invent
 * missing facts. Everything is imported as a draft "needs_review" record and
 * products are NOT enabled for online checkout until the owner confirms it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCsv, writeCsv } from "../lib/csv";
import { clean, parsePrice, type PageExtract } from "../lib/extract";
import { slugifyName, type Catalog, type CatalogProduct } from "../lib/catalog-format";

const DATA = process.env.MIGRATION_DATA_DIR ?? "data";
const flags: { record: string; field: string; issue: string; source_url: string }[] = [];
const flag = (record: string, field: string, issue: string, source_url = "") => flags.push({ record, field, issue, source_url });

const products = existsSync(`${DATA}/product-inventory.csv`) ? readCsv(`${DATA}/product-inventory.csv`) : [];
const assets = existsSync(`${DATA}/asset-inventory.csv`) ? readCsv(`${DATA}/asset-inventory.csv`) : [];
const pagesDir = `${DATA}/audit/pages`;
const pages: PageExtract[] = existsSync(pagesDir) ? readdirSync(pagesDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(pagesDir, f), "utf8"))) : [];
const report = existsSync(`${DATA}/audit/crawl-report.json`) ? JSON.parse(readFileSync(`${DATA}/audit/crawl-report.json`, "utf8")) : null;

const localFor = new Map(assets.filter((a) => a.download_status === "downloaded" && a.local_path).map((a) => [a.source_url, a]));
const titleCase = (s: string) => clean(s).toLowerCase().replace(/(^|[\s/&-])\p{L}/gu, (m) => m.toUpperCase());

const catalog: Catalog = { generatedAt: new Date().toISOString(), source: report?.origin ?? null, categories: [], products: [], faqs: [], pages: [], gallery: [], settings: {} };
const categories = new Map<string, Catalog["categories"][number]>();
const usedSlugs = new Set<string>();

for (const p of products) {
  const name = clean(p.name);
  if (!name) continue;
  let slug = slugifyName(name);
  while (usedSlugs.has(slug)) slug = `${slug}-2`;
  usedSlugs.add(slug);

  let categorySlug: string | null = null;
  if (clean(p.category)) {
    const catName = titleCase(p.category);
    categorySlug = slugifyName(catName);
    if (!categories.has(categorySlug)) categories.set(categorySlug, { slug: categorySlug, name: catName, description: null, sourceUrl: null });
  } else flag(name, "category", "No category found on the source site.", p.source_url);

  // Price: a single unambiguous price only.
  const currency = (clean(p.currency) || "USD").toLowerCase();
  if (clean(p.currency) && clean(p.currency).toUpperCase() !== "USD") flag(name, "currency", `Source currency is ${p.currency}; site is configured for USD.`, p.source_url);
  let basePriceCents: number | null = null;
  const options: CatalogProduct["options"] = [];
  const variants = safeJson<{ title: string; price: number | null; available: boolean | null }[]>(p.variants_json, []);
  const sourceOptions = safeJson<{ name: string; values: string[] }[]>(p.options_json, []);
  const variantPrices = variants.map((v) => v.price).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (variantPrices.length) {
    const min = Math.min(...variantPrices);
    basePriceCents = Math.round(min * 100);
    if (sourceOptions.length === 1) {
      options.push({
        name: titleCase(sourceOptions[0].name),
        required: true,
        values: variants.map((v) => ({ label: clean(v.title), priceDeltaCents: Math.round(((v.price ?? min) - min) * 100), available: v.available !== false })),
      });
    } else if (sourceOptions.length > 1) {
      flag(name, "options", `Has ${sourceOptions.length} option dimensions with per-combination prices; set options manually.`, p.source_url);
      for (const o of sourceOptions) options.push({ name: titleCase(o.name), required: true, values: o.values.map((v) => ({ label: clean(v), priceDeltaCents: 0, available: true })) });
    }
  } else if (clean(p.price)) {
    const n = Number(p.price);
    if (Number.isFinite(n) && n >= 0) basePriceCents = Math.round(n * 100);
  } else {
    const parsed = parsePrice(p.price_text);
    if (parsed) basePriceCents = Math.round(parsed.amount * 100);
  }
  if (basePriceCents === null) flag(name, "price", `No single unambiguous price${p.price_text ? ` (source says "${p.price_text}")` : ""}. Imported as "price on request".`, p.source_url);

  const images = p.image_urls
    .split(" | ")
    .filter(Boolean)
    .map((u) => ({ u, a: localFor.get(u) }))
    .filter(({ u, a }) => {
      if (!a) flag(name, "image", `Image not downloaded: ${u}`, p.source_url);
      return !!a;
    })
    .map(({ u, a }) => {
      if (!clean(a!.alt)) flag(name, "image_alt", `No alt text for ${a!.local_path}; describe the photo before publishing.`, p.source_url);
      return { src: a!.local_path, alt: clean(a!.alt), width: Number(a!.width) || null, height: Number(a!.height) || null, sourceUrl: u };
    });

  if (/out ?of ?stock|discontinued|soldout/i.test(p.availability)) flag(name, "availability", `Source shows "${p.availability}".`, p.source_url);
  const description = clean(p.description) || null;
  if (!description) flag(name, "description", "No description on the source site.", p.source_url);

  catalog.products.push({
    slug,
    name,
    category: categorySlug,
    summary: null,
    description,
    basePriceCents,
    currency,
    status: "draft",
    directPurchase: false,
    customOrder: false,
    options,
    images,
    sourceUrl: p.source_url || null,
    migrationStatus: "needs_review",
    migrationNotes: `Migrated ${new Date().toISOString().slice(0, 10)} from ${p.source_url}. Confirm price, options, availability, allergens and ordering route.`,
  });
  flag(name, "ordering", "Confirm whether this can be bought online, requested as a custom order, or both.", p.source_url);
}
catalog.categories = [...categories.values()];

// Long-form pages and FAQs.
for (const page of pages) {
  const h1 = page.headings.find((h) => h.level === 1)?.text ?? page.title ?? "";
  if (page.pageType === "about" || page.pageType === "policy") {
    const body = page.textBlocks.filter((t) => t !== h1).join("\n\n");
    if (body.length < 40) continue;
    const slug = page.pageType === "about" ? "about" : slugifyName(new URL(page.url).pathname.split("/").filter(Boolean).pop() ?? h1);
    catalog.pages.push({ slug, title: clean(h1) || titleCase(slug.replace(/-/g, " ")), body, kind: page.pageType === "about" ? "about" : "policy", published: false, sourceUrl: page.url, seoTitle: page.title, seoDescription: page.metaDescription });
    flag(`page:${slug}`, "body", "Review text extracted from the old page before publishing.", page.url);
  }
  if (page.pageType === "faq") {
    const blocks = page.textBlocks;
    for (let i = 0; i < blocks.length; i++) {
      if (!blocks[i].endsWith("?")) continue;
      const answer: string[] = [];
      for (let j = i + 1; j < blocks.length && !blocks[j].endsWith("?"); j++) answer.push(blocks[j]);
      if (answer.length) catalog.faqs.push({ question: blocks[i], answer: answer.join("\n\n"), published: false, sourceUrl: page.url });
    }
    flag("faqs", "pairs", "Questions and answers were paired automatically; check every pair.", page.url);
  }
}

// Gallery: downloaded images not already used by a product.
const productImageSrc = new Set(catalog.products.flatMap((p) => p.images.map((i) => i.src)));
for (const a of localFor.values()) {
  if (a.suggested_group !== "gallery" || productImageSrc.has(a.local_path) || a.context === "document") continue;
  if (Number(a.width) && Number(a.width) < 300) continue; // icons, tiny decorations
  catalog.gallery.push({ src: a.local_path, alt: clean(a.alt), caption: null, width: Number(a.width) || null, height: Number(a.height) || null, published: false, sourceUrl: a.source_url });
  if (!clean(a.alt)) flag(`gallery:${a.local_path}`, "alt", "Add alt text before publishing.", a.source_url);
}

// Business details: only facts that are unambiguous.
const biz = report?.business ?? { emails: [], phones: [], socialLinks: [] };
if (biz.emails.length === 1) catalog.settings.contactEmail = biz.emails[0];
else if (biz.emails.length > 1) flag("settings", "contactEmail", `Several emails found: ${biz.emails.join(", ")}.`);
if (biz.phones.length === 1) catalog.settings.contactPhone = biz.phones[0];
else if (biz.phones.length > 1) flag("settings", "contactPhone", `Several phone numbers found: ${biz.phones.join(", ")}.`);
const socials = (biz.socialLinks as string[]).filter((u) => u.startsWith("https://")).map((url) => ({ label: titleCase(new URL(url).hostname.replace(/^www\./, "").split(".")[0]), url }));
if (socials.length) catalog.settings.socialLinks = socials;
flag("settings", "commerce", "Tax rate, pickup/delivery rules, fees, lead times and fulfilment days must be entered and confirmed by the owner in Admin → Settings.");

function safeJson<T>(s: string | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

mkdirSync(`${DATA}/content`, { recursive: true });
writeFileSync(`${DATA}/content/catalog.json`, JSON.stringify(catalog, null, 2) + "\n");
writeCsv(`${DATA}/migration-flags.csv`, ["record", "field", "issue", "source_url"], flags);
console.log(`catalog.json: ${catalog.products.length} products, ${catalog.categories.length} categories, ${catalog.pages.length} pages, ${catalog.faqs.length} FAQs, ${catalog.gallery.length} gallery images. ${flags.length} items flagged for owner review.`);
