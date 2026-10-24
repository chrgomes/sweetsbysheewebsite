/**
 * Map every old URL in data/page-inventory.csv to its new route and write
 * data/redirects.json (permanent redirects, loaded by next.config.ts) and
 * data/url-map.csv (the full mapping for review). Old URLs that already exist
 * unchanged on the new site need no redirect. Unmatched URLs are listed for
 * manual mapping; edit data/redirects.json by hand to finish.
 *
 *   pnpm migrate:redirects
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readCsv, writeCsv } from "../lib/csv";

const DATA = process.env.MIGRATION_DATA_DIR ?? "data";
import type { Catalog } from "../lib/catalog-format";

const pages = existsSync(`${DATA}/page-inventory.csv`) ? readCsv(`${DATA}/page-inventory.csv`) : [];
const catalog: Catalog | null = existsSync(`${DATA}/content/catalog.json`) ? JSON.parse(readFileSync(`${DATA}/content/catalog.json`, "utf8")) : null;
const NEW_ROUTES = new Set(["/", "/shop", "/custom-orders", "/gallery", "/about", "/faq", "/contact", "/cart", "/checkout"]);

const bySource = new Map<string, string>();
for (const p of catalog?.products ?? []) if (p.sourceUrl) bySource.set(new URL(p.sourceUrl).pathname.replace(/\/$/, "") || "/", `/products/${p.slug}`);
for (const pg of catalog?.pages ?? []) if (pg.sourceUrl) bySource.set(new URL(pg.sourceUrl).pathname.replace(/\/$/, "") || "/", pg.kind === "about" ? "/about" : `/policies/${pg.slug}`);

const PATTERNS: [RegExp, string][] = [
  [/^\/(shop|store|menu|order|order-online|products|collections(\/all)?)$/i, "/shop"],
  [/(custom|inquir|enquir|request|quote|order-form)/i, "/custom-orders"],
  [/(about|our-story|story)/i, "/about"],
  [/contact/i, "/contact"],
  [/(faq|questions)/i, "/faq"],
  [/(gallery|portfolio|photos)/i, "/gallery"],
];

const rows: { old_url: string; old_path: string; page_type: string; new_path: string; match: string }[] = [];
for (const p of pages) {
  const u = new URL(p.url);
  const oldPath = (u.pathname.replace(/\/$/, "") || "/") + u.search;
  let target = bySource.get(u.pathname.replace(/\/$/, "") || "/");
  let match = target ? "catalog" : "";
  if (!target && NEW_ROUTES.has(oldPath)) {
    target = oldPath;
    match = "same";
  }
  if (!target) {
    const cat = catalog?.categories.find((c) => u.pathname.toLowerCase().includes(c.slug));
    if (cat && p.page_type === "category") {
      target = `/shop/${cat.slug}`;
      match = "category";
    }
  }
  if (!target) {
    const hit = PATTERNS.find(([re]) => re.test(u.pathname));
    if (hit) {
      target = hit[1];
      match = "pattern";
    }
  }
  rows.push({ old_url: p.url, old_path: oldPath, page_type: p.page_type, new_path: target ?? "", match: target ? match : "UNMATCHED — map manually" });
}

const redirects = rows.filter((r) => r.new_path && r.old_path !== r.new_path && !r.old_path.includes("?")).map((r) => ({ source: r.old_path, destination: r.new_path, permanent: true }));
writeFileSync(`${DATA}/redirects.json`, JSON.stringify(redirects, null, 2) + "\n");
writeCsv(`${DATA}/url-map.csv`, ["old_url", "old_path", "page_type", "new_path", "match"], rows);
console.log(`${redirects.length} redirects written; ${rows.filter((r) => !r.new_path).length} URLs need manual mapping (see data/url-map.csv).`);
