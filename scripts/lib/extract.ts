/**
 * Pure HTML extraction for the site audit. Everything scraped is treated as
 * untrusted data: it is parsed and recorded, never executed or followed as
 * instructions.
 */
import * as cheerio from "cheerio";

export type ImageRef = { url: string; alt: string; context: "img" | "srcset" | "og" | "css" | "json-ld" | "link" };

export type ProductCandidate = {
  name: string;
  description: string | null;
  priceText: string | null;
  price: number | null;
  currency: string | null;
  availability: string | null;
  images: string[];
  sku: string | null;
  category: string | null;
  source: "json-ld" | "open-graph" | "microdata" | "heuristic";
};

export type PageExtract = {
  url: string;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robots: string | null;
  ogType: string | null;
  lang: string | null;
  headings: { level: number; text: string }[];
  textBlocks: string[];
  links: { href: string; text: string; internal: boolean }[];
  images: ImageRef[];
  jsonLd: unknown[];
  products: ProductCandidate[];
  emails: string[];
  phones: string[];
  socialLinks: string[];
  forms: { action: string | null; method: string; fields: string[] }[];
  documents: string[];
  platform: string | null;
  pageType: string;
  wordCount: number;
};

const SOCIAL_HOSTS = /(^|\.)(instagram\.com|facebook\.com|tiktok\.com|pinterest\.[a-z.]+|x\.com|twitter\.com|youtube\.com|threads\.net|linkedin\.com|yelp\.com)$/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?)(\?|#|$)/i;

export const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function normalizeUrl(raw: string, base: string): string | null {
  try {
    const u = new URL(raw.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    // Drop common tracking parameters.
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(p)) u.searchParams.delete(p);
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return null;
  }
}

/** "$1,234.50" → { amount: 1234.5, currency: "USD" }. Returns null for ambiguous text like "$30–$45". */
export function parsePrice(text: string | null | undefined): { amount: number; currency: string | null } | null {
  const t = clean(text);
  if (!t) return null;
  const matches = t.match(/(?:[$£€]|USD|CAD|GBP|EUR)?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g)?.filter((m) => /\d/.test(m)) ?? [];
  if (matches.length !== 1) return null;
  const m = matches[0];
  const currency = /£|GBP/.test(m) ? "GBP" : /€|EUR/.test(m) ? "EUR" : /CAD/.test(m) ? "CAD" : /\$|USD/.test(m) ? "USD" : null;
  const amount = Number(m.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? { amount, currency } : null;
}

function detectPlatform($: cheerio.CheerioAPI, html: string): string | null {
  const gen = $('meta[name="generator"]').attr("content") ?? "";
  if (/squarespace/i.test(gen) || html.includes("static1.squarespace.com")) return "squarespace";
  if (/wix/i.test(gen) || html.includes("static.wixstatic.com")) return "wix";
  if (html.includes("cdn.shopify.com") || html.includes("Shopify.theme")) return "shopify";
  if (/woocommerce/i.test(html)) return "woocommerce";
  if (/wordpress/i.test(gen) || html.includes("/wp-content/")) return "wordpress";
  if (/weebly/i.test(gen) || html.includes("editmysite.com")) return "weebly";
  if (html.includes("square.site") || html.includes("squareup.com")) return "square-online";
  if (/godaddy|websitebuilder/i.test(gen)) return "godaddy";
  return gen ? clean(gen) : null;
}

function flattenJsonLd(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) node.forEach((n) => flattenJsonLd(n, out));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    out.push(o);
    if (o["@graph"]) flattenJsonLd(o["@graph"], out);
  }
  return out;
}

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const typeOf = (o: Record<string, unknown>) => asArray(o["@type"] as string | string[]).map(String);

function productsFromJsonLd(items: Record<string, unknown>[], base: string): ProductCandidate[] {
  return items
    .filter((o) => typeOf(o).includes("Product"))
    .map((o) => {
      const offers = asArray(o.offers as Record<string, unknown> | Record<string, unknown>[]);
      const offer = offers[0] ?? {};
      const priceRaw = (offer.price ?? offer.lowPrice) as string | number | undefined;
      const images = asArray(o.image as unknown)
        .map((i) => (typeof i === "string" ? i : ((i as Record<string, unknown>)?.url as string)))
        .filter(Boolean)
        .map((i) => normalizeUrl(i, base))
        .filter((i): i is string => !!i);
      return {
        name: clean(String(o.name ?? "")),
        description: clean(String(o.description ?? "")) || null,
        // Keep ranges as ranges so they're never mistaken for a single price.
        priceText: offer.highPrice !== undefined && priceRaw !== undefined ? `${priceRaw}–${offer.highPrice}` : priceRaw !== undefined ? String(priceRaw) : null,
        price: priceRaw !== undefined && Number.isFinite(Number(priceRaw)) && offers.length === 1 && !offer.highPrice ? Number(priceRaw) : null,
        currency: (offer.priceCurrency as string) ?? null,
        availability: offer.availability ? String(offer.availability).replace(/^https?:\/\/schema\.org\//, "") : null,
        images,
        sku: o.sku ? String(o.sku) : null,
        category: o.category ? clean(String(o.category)) : null,
        source: "json-ld" as const,
      };
    })
    .filter((p) => p.name);
}

function classify(url: string, $: cheerio.CheerioAPI, products: ProductCandidate[], ogType: string | null): string {
  const path = new URL(url).pathname.toLowerCase();
  if (path === "/" || path === "") return "home";
  if (products.length === 1 || ogType === "product" || /\/(product|products|p|item|shop\/p)\//.test(path)) return "product";
  if (/\/(shop|menu|store|collections?|categor(y|ies)|order-online)(\/|$)/.test(path)) return "category";
  if (/(custom|inquir|enquir|request|quote|order-form)/.test(path)) return "custom-order";
  if (/(about|story|our-baker)/.test(path)) return "about";
  if (/(contact)/.test(path)) return "contact";
  if (/(faq|questions)/.test(path)) return "faq";
  if (/(gallery|portfolio|photos)/.test(path)) return "gallery";
  if (/(polic|terms|privacy|refund|shipping|allerg)/.test(path)) return "policy";
  if (/(blog|news|post)/.test(path)) return "blog";
  if (/(cart|checkout|account|login)/.test(path)) return "commerce-system";
  if ($("form").length) return "form";
  return "content";
}

export function extractPage(html: string, url: string, origin: string): PageExtract {
  const $ = cheerio.load(html);
  const abs = (u: string | undefined | null) => (u ? normalizeUrl(u, url) : null);

  const jsonLdRaw: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      jsonLdRaw.push(JSON.parse($(el).contents().text()));
    } catch {
      /* malformed JSON-LD is ignored */
    }
  });
  const ld = flattenJsonLd(jsonLdRaw);

  const images: ImageRef[] = [];
  const pushImg = (u: string | null, alt: string, context: ImageRef["context"]) => {
    if (u && !u.startsWith("data:")) images.push({ url: u, alt: clean(alt), context });
  };
  $("img").each((_, el) => {
    const $el = $(el);
    const alt = $el.attr("alt") ?? "";
    pushImg(abs($el.attr("src")), alt, "img");
    for (const attr of ["data-src", "data-image", "data-lazy-src", "data-original"]) pushImg(abs($el.attr(attr)), alt, "img");
    for (const attr of ["srcset", "data-srcset"]) {
      const set = $el.attr(attr);
      if (!set) continue;
      // Keep the largest candidate in a srcset.
      const best = set
        .split(",")
        .map((c) => c.trim().split(/\s+/))
        .map(([u, d]) => ({ u, w: Number((d ?? "1w").replace(/\D/g, "")) || 1 }))
        .sort((a, b) => b.w - a.w)[0];
      pushImg(abs(best?.u), alt, "srcset");
    }
  });
  $("source[srcset]").each((_, el) => pushImg(abs($(el).attr("srcset")?.split(",").pop()?.trim().split(/\s+/)[0]), "", "srcset"));
  $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => pushImg(abs($(el).attr("content")), "", "og"));
  $('link[rel~="icon"], link[rel="apple-touch-icon"]').each((_, el) => pushImg(abs($(el).attr("href")), "icon", "link"));
  $("[style*='url(']").each((_, el) => {
    for (const m of ($(el).attr("style") ?? "").matchAll(/url\((['"]?)(.*?)\1\)/g)) pushImg(abs(m[2]), "", "css");
  });
  for (const o of ld) for (const i of asArray(o.image as unknown)) pushImg(abs(typeof i === "string" ? i : ((i as Record<string, unknown>)?.url as string)), "", "json-ld");
  const seen = new Set<string>();
  const uniqueImages = images.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));

  const links: PageExtract["links"] = [];
  const documents = new Set<string>();
  const social = new Set<string>();
  const emails = new Set<string>();
  const phones = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!;
    if (href.startsWith("mailto:")) return void emails.add(decodeURIComponent(href.slice(7).split("?")[0]).toLowerCase());
    if (href.startsWith("tel:")) return void phones.add(clean(decodeURIComponent(href.slice(4))));
    const u = abs(href);
    if (!u) return;
    const internal = new URL(u).origin === origin;
    links.push({ href: u, text: clean($(el).text()).slice(0, 200), internal });
    if (DOC_EXT.test(u)) documents.add(u);
    if (!internal && SOCIAL_HOSTS.test(new URL(u).hostname)) social.add(u);
  });

  const products = productsFromJsonLd(ld, url);
  const ogType = $('meta[property="og:type"]').attr("content") ?? null;
  if (!products.length && (ogType === "product" || $('meta[property="product:price:amount"]').length)) {
    const amount = $('meta[property="product:price:amount"], meta[property="og:price:amount"]').attr("content") ?? null;
    products.push({
      name: clean($('meta[property="og:title"]').attr("content") ?? $("h1").first().text()),
      description: clean($('meta[property="og:description"]').attr("content")) || null,
      priceText: amount,
      price: amount && Number.isFinite(Number(amount)) ? Number(amount) : null,
      currency: $('meta[property="product:price:currency"], meta[property="og:price:currency"]').attr("content") ?? null,
      availability: $('meta[property="product:availability"], meta[property="og:availability"]').attr("content") ?? null,
      images: uniqueImages.filter((i) => i.context === "og").map((i) => i.url),
      sku: null,
      category: null,
      source: "open-graph",
    });
  }
  if (!products.length) {
    $('[itemtype*="schema.org/Product"]').each((_, el) => {
      const $p = $(el);
      const priceText = $p.find('[itemprop="price"]').attr("content") ?? clean($p.find('[itemprop="price"]').text());
      products.push({
        name: clean($p.find('[itemprop="name"]').first().text()),
        description: clean($p.find('[itemprop="description"]').first().text()) || null,
        priceText: priceText || null,
        price: parsePrice(priceText)?.amount ?? null,
        currency: $p.find('[itemprop="priceCurrency"]').attr("content") ?? null,
        availability: $p.find('[itemprop="availability"]').attr("href") ?? null,
        images: $p.find('[itemprop="image"]').map((_, i) => abs($(i).attr("src") ?? $(i).attr("content"))).get().filter(Boolean),
        sku: null,
        category: null,
        source: "microdata",
      });
    });
  }

  const headings: PageExtract["headings"] = [];
  $("h1, h2, h3, h4").each((_, el) => {
    const text = clean($(el).text());
    if (text) headings.push({ level: Number(el.tagName.slice(1)), text });
  });

  const forms = $("form")
    .map((_, el) => ({
      action: abs($(el).attr("action")),
      method: ($(el).attr("method") ?? "get").toLowerCase(),
      fields: $(el)
        .find("input, select, textarea")
        .map((_, f) => $(f).attr("name") ?? $(f).attr("id") ?? $(f).attr("type") ?? "")
        .get()
        .filter(Boolean),
    }))
    .get();

  // Visible text blocks, without scripts, navigation chrome or styles.
  const $body = cheerio.load(html);
  $body("script, style, noscript, svg, nav, header, footer, form, iframe").remove();
  const blocks: string[] = [];
  $body("p, li, h1, h2, h3, h4, blockquote, td, dt, dd").each((_, el) => {
    const t = clean($body(el).text());
    if (t.length >= 3 && !blocks.includes(t)) blocks.push(t);
  });
  const bodyText = clean($body("body").text());
  for (const m of bodyText.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) emails.add(m[0].toLowerCase());

  return {
    url,
    title: clean($("title").first().text()) || null,
    metaDescription: clean($('meta[name="description"]').attr("content")) || null,
    canonical: abs($('link[rel="canonical"]').attr("href")),
    robots: $('meta[name="robots"]').attr("content") ?? null,
    ogType,
    lang: $("html").attr("lang") ?? null,
    headings,
    textBlocks: blocks,
    links,
    images: uniqueImages,
    jsonLd: jsonLdRaw,
    products,
    emails: [...emails],
    phones: [...phones],
    socialLinks: [...social],
    forms,
    documents: [...documents],
    platform: detectPlatform($, html),
    pageType: classify(url, $, products, ogType),
    wordCount: bodyText ? bodyText.split(" ").length : 0,
  };
}

/** Minimal robots.txt evaluation for a single user agent (longest-match wins, Allow beats Disallow on ties). */
export function robotsAllows(robotsTxt: string, path: string, agent = "*"): boolean {
  type Rule = { allow: boolean; path: string };
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = m;
    if (/^user-agent$/i.test(key)) {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && /^(allow|disallow)$/i.test(key) && value) current.rules.push({ allow: /^allow$/i.test(key), path: value });
    }
  }
  const group = groups.find((g) => g.agents.includes(agent.toLowerCase())) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  const toRegex = (p: string) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  let best: Rule | null = null;
  for (const r of group.rules) {
    if (toRegex(r.path).test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return best ? best.allow : true;
}

export function sitemapUrls(xml: string): { pages: string[]; sitemaps: string[] } {
  const $ = cheerio.load(xml, { xml: true });
  return {
    pages: $("urlset > url > loc").map((_, el) => clean($(el).text())).get(),
    sitemaps: $("sitemapindex > sitemap > loc").map((_, el) => clean($(el).text())).get(),
  };
}
