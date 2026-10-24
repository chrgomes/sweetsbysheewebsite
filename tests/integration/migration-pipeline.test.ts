import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { readCsv } from "../../scripts/lib/csv";
import { resetDb } from "../support/db";

/**
 * Runs the real migration scripts (crawl → download → normalise → import →
 * redirects) against a local fixture site that mimics a small bakery website.
 */
const SITE = path.resolve("tests/fixtures/source-site");
let server: Server;
let origin = "";
const work = mkdtempSync(path.join(tmpdir(), "sbs-migration-"));
const dataDir = path.join(work, "data");
const publicDir = path.join(work, "public", "images");

// Async on purpose: a synchronous exec would block the fixture server in this process.
const execFileAsync = promisify(execFile);
async function run(script: string, args: string[] = []) {
  const { stdout } = await execFileAsync("npx", ["tsx", script, ...args], {
    env: { ...process.env, HTTPS_PROXY: "", HTTP_PROXY: "", NODE_USE_ENV_PROXY: "", MIGRATION_DATA_DIR: dataDir },
    encoding: "utf8",
    timeout: 120_000,
  });
  return stdout;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const candidates = url.pathname === "/" ? ["index.html"] : [url.pathname.slice(1), `${url.pathname.slice(1)}.html`, `${url.pathname.slice(1)}/index.html`];
    for (const c of candidates) {
      const file = path.join(SITE, c);
      if (file.startsWith(SITE) && existsSync(file) && !file.endsWith("/")) {
        try {
          const body = readFileSync(file);
          const type = file.endsWith(".png") ? "image/png" : file.endsWith(".xml") ? "application/xml" : file.endsWith(".txt") ? "text/plain" : "text/html";
          res.writeHead(200, { "Content-Type": type });
          return res.end(body);
        } catch {
          /* directory */
        }
      }
    }
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end("<h1>Not found</h1>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  await resetDb();
}, 30_000);

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("content migration pipeline", () => {
  it("crawls the site politely and inventories pages, products and assets", async () => {
    const out = await run("scripts/audit/crawl.ts", ["--start", `${origin}/`, "--out", dataDir, "--delay", "0"]);
    expect(out).toMatch(/Crawled \d+ pages/);
    const pages = readCsv(path.join(dataDir, "page-inventory.csv"));
    const paths = pages.map((p) => new URL(p.url).pathname);
    expect(paths).toEqual(expect.arrayContaining(["/", "/menu", "/menu/lemon-loaf", "/menu/celebration-cake", "/about-us", "/faq", "/custom-cakes", "/refund-policy"]));
    expect(paths).not.toContain("/private/secret"); // robots.txt respected
    const report = JSON.parse(readFileSync(path.join(dataDir, "audit/crawl-report.json"), "utf8"));
    expect(report.skippedByRobots.some((u: string) => u.includes("/private/secret"))).toBe(true);
    expect(report.business.emails).toEqual(["hello@fixture.test"]);
    expect(report.business.forms[0].forms[0].fields).toEqual(["name", "email", "details"]);

    const products = readCsv(path.join(dataDir, "product-inventory.csv"));
    const loaf = products.find((p) => p.name === "Lemon Loaf")!;
    expect(loaf).toMatchObject({ price: "18", category: "breads", migration_status: "needs_review" });
    const cake = products.find((p) => p.name === "Celebration Cake")!;
    expect(cake.price).toBe(""); // a price range is never collapsed to one number
    expect(cake.review_flags).toContain("price-missing-or-ambiguous");

    const assets = readCsv(path.join(dataDir, "asset-inventory.csv"));
    expect(assets.map((a) => a.source_url)).toEqual(expect.arrayContaining([`${origin}/images/hero.png`, `${origin}/images/loaf.png`, "https://third-party.example/stock.jpg"]));
  });

  it("downloads only the owner's assets, keeps originals and records provenance", async () => {
    await run("scripts/migration/download-assets.ts", ["--inventory", path.join(dataDir, "asset-inventory.csv"), "--public-dir", publicDir, "--originals-dir", path.join(dataDir, "assets/originals"), "--delay", "0"]);
    const assets = readCsv(path.join(dataDir, "asset-inventory.csv"));
    const loaf = assets.find((a) => a.source_url.endsWith("loaf.png"))!;
    expect(loaf).toMatchObject({ download_status: "downloaded", width: "600", height: "600", format: "png" });
    expect(loaf.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(path.join(publicDir, loaf.local_path.replace(/^\/images\//, "")))).toBe(true);
    expect(assets.find((a) => a.source_url.includes("third-party"))!.download_status).toBe("skipped_third_party");
    // Idempotent rerun.
    const again = await run("scripts/migration/download-assets.ts", ["--inventory", path.join(dataDir, "asset-inventory.csv"), "--public-dir", publicDir, "--originals-dir", path.join(dataDir, "assets/originals"), "--delay", "0"]);
    expect(again).not.toContain("✓");
  });

  it("normalises without inventing facts, then imports idempotently", async () => {
    await run("scripts/migration/normalize.ts");
    const catalog = JSON.parse(readFileSync(path.join(dataDir, "content/catalog.json"), "utf8"));
    const loaf = catalog.products.find((p: { slug: string }) => p.slug === "lemon-loaf");
    expect(loaf).toMatchObject({ name: "Lemon Loaf", description: "Zesty lemon loaf with glaze.", basePriceCents: 1800, category: "breads", status: "draft", directPurchase: false });
    expect(loaf.images[0]).toMatchObject({ alt: "Lemon loaf with white glaze" });
    expect(catalog.products.find((p: { slug: string }) => p.slug === "celebration-cake").basePriceCents).toBeNull();
    expect(catalog.faqs).toHaveLength(2);
    expect(catalog.pages.map((p: { slug: string }) => p.slug).sort()).toEqual(["about", "refund-policy"]);
    expect(catalog.settings.contactEmail).toBe("hello@fixture.test");
    const flags = readCsv(path.join(dataDir, "migration-flags.csv"));
    expect(flags.some((f) => f.record === "Celebration Cake" && f.field === "price")).toBe(true);

    const file = path.join(dataDir, "content/catalog.json");
    await run("scripts/migration/import-content.ts", ["--file", file]);
    await run("scripts/migration/import-content.ts", ["--file", file]);
    const products = await db().query.products.findMany({ with: { images: true } });
    expect(products).toHaveLength(2);
    expect(products.every((p) => p.status === "draft" && p.migrationStatus === "needs_review" && p.sourceUrl)).toBe(true);
    expect(await db().query.faqs.findMany()).toHaveLength(2);
    expect((await db().query.categories.findMany()).map((c) => c.name)).toEqual(["Breads"]);

    // Owner edits survive a re-import.
    await db().update(schema.products).set({ name: "Owner Renamed Loaf", migrationStatus: "verified" });
    await run("scripts/migration/import-content.ts", ["--file", file]);
    expect((await db().query.products.findMany()).every((p) => p.name === "Owner Renamed Loaf")).toBe(true);
  });

  it("maps old URLs to new routes", async () => {
    await run("scripts/migration/build-redirects.ts");
    const redirects = JSON.parse(readFileSync(path.join(dataDir, "redirects.json"), "utf8"));
    expect(redirects).toEqual(
      expect.arrayContaining([
        { source: "/menu/lemon-loaf", destination: "/products/lemon-loaf", permanent: true },
        { source: "/menu", destination: "/shop", permanent: true },
        { source: "/about-us", destination: "/about", permanent: true },
        { source: "/custom-cakes", destination: "/custom-orders", permanent: true },
        { source: "/refund-policy", destination: "/policies/refund-policy", permanent: true },
      ]),
    );
    expect(redirects.some((r: { source: string }) => r.source === "/faq")).toBe(false); // unchanged URL
  });
});
