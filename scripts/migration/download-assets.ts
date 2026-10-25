/**
 * Download images and documents listed in data/asset-inventory.csv.
 *
 *   NODE_USE_ENV_PROXY=1 pnpm migrate:assets [--allow-host cdn.example.com] [--limit 500]
 *
 * - Only downloads from the site's own origin and the website platform's
 *   media CDN (where the owner's uploads live). Anything else — social
 *   embeds, stock libraries, other sites — is recorded as "skipped_third_party"
 *   for manual review: the owner's authorisation doesn't cover it.
 * - Originals are preserved untouched in data/assets/originals/.
 * - Web derivatives (max 2400px, WebP, metadata stripped) go to
 *   public/images/<group>/ and are what the site serves. Nothing is hotlinked.
 * - Idempotent: files already downloaded with a matching hash are skipped.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { readCsv, writeCsv } from "../lib/csv";
import { ASSET_HEADERS } from "../lib/inventory";

const { values: args } = parseArgs({
  options: {
    inventory: { type: "string", default: "data/asset-inventory.csv" },
    "allow-host": { type: "string", multiple: true, default: [] },
    limit: { type: "string", default: "2000" },
    delay: { type: "string", default: "400" },
    "public-dir": { type: "string", default: "public/images" },
    "originals-dir": { type: "string", default: "data/assets/originals" },
  },
});

/** Media CDNs used by common site builders to host the site owner's own uploads. */
export const PLATFORM_MEDIA_HOSTS = [
  /(^|\.)squarespace-cdn\.com$/,
  /^static1\.squarespace\.com$/,
  /^static\.wixstatic\.com$/,
  /^cdn\.shopify\.com$/,
  /(^|\.)editmysite\.com$/,
  /(^|\.)square-cdn\.com$/,
  /^img1\.wsimg\.com$/,
];

const rows = readCsv(args.inventory!);
if (!rows.length) {
  console.log(`No assets listed in ${args.inventory}. Run pnpm audit:crawl first.`);
  process.exit(0);
}
const siteHosts = new Set(rows.flatMap((r) => r.source_pages.split(" | ")).filter(Boolean).map((u) => new URL(u).hostname));
const extraHosts = new Set(args["allow-host"]);
const allowedHost = (h: string) => siteHosts.has(h) || extraHosts.has(h) || PLATFORM_MEDIA_HOSTS.some((re) => re.test(h));

const slug = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "image";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let processed = 0;

for (const row of rows) {
  if (processed >= Number(args.limit)) break;
  if (row.download_status === "downloaded" && row.local_path && existsSync(path.join(args["public-dir"]!, row.local_path.replace(/^\/images\//, "")))) continue;
  const url = new URL(row.source_url);
  if (!allowedHost(url.hostname)) {
    row.download_status = "skipped_third_party";
    row.rights_notes ||= `Hosted on ${url.hostname}; not covered by the owner's authorisation. Confirm rights or replace.`;
    continue;
  }
  processed++;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "SweetsByShyeeSiteMigration/1.0 (authorized by site owner)" }, signal: AbortSignal.timeout(30_000) });
    await sleep(Number(args.delay));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const sha = createHash("sha256").update(bytes).digest("hex");
    const group = row.suggested_group || "gallery";
    const base = `${slug(row.associated_product || row.original_filename)}-${sha.slice(0, 8)}`;

    if (row.context === "document") {
      const ext = path.extname(url.pathname) || ".pdf";
      const docDir = path.join(args["public-dir"]!, "..", "documents");
      mkdirSync(docDir, { recursive: true });
      writeFileSync(path.join(docDir, base + ext), bytes);
      Object.assign(row, { local_path: `/documents/${base}${ext}`, bytes: bytes.length, sha256: sha, format: ext.slice(1), download_status: "downloaded" });
      continue;
    }

    const meta = await sharp(bytes, { animated: false }).metadata();
    if (!meta.format || !meta.width) throw new Error("not a decodable image");
    const origDir = path.join(args["originals-dir"]!, group);
    mkdirSync(origDir, { recursive: true });
    const origPath = path.join(origDir, `${base}.${meta.format === "jpeg" ? "jpg" : meta.format}`);
    if (!existsSync(origPath) || createHash("sha256").update(readFileSync(origPath)).digest("hex") !== sha) writeFileSync(origPath, bytes);

    let localPath = "";
    if (meta.format === "svg" || meta.format === "gif") {
      // Keep vector logos and animations as-is.
      const outDir = path.join(args["public-dir"]!, group);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, `${base}.${meta.format}`), bytes);
      localPath = `/images/${group}/${base}.${meta.format}`;
    } else {
      const outDir = path.join(args["public-dir"]!, group);
      mkdirSync(outDir, { recursive: true });
      await sharp(bytes).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toFile(path.join(outDir, `${base}.webp`));
      localPath = `/images/${group}/${base}.webp`;
    }
    Object.assign(row, { local_path: localPath, width: meta.width, height: meta.height, format: meta.format, bytes: bytes.length, sha256: sha, download_status: "downloaded" });
    console.log(`✓ ${row.source_url} → ${localPath}`);
  } catch (err) {
    row.download_status = `failed: ${String((err as Error).message ?? err).slice(0, 120)}`;
    console.warn(`✗ ${row.source_url}: ${row.download_status}`);
  }
}

writeCsv(args.inventory!, ASSET_HEADERS, rows);
const tally = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.download_status.split(":")[0]] = (acc[r.download_status.split(":")[0]] ?? 0) + 1), acc), {});
console.log("\nAsset status:", tally);
