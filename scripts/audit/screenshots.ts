/**
 * Capture desktop and mobile screenshots of pages for the audit record.
 *
 *   pnpm audit:screenshots [--base https://sweetsbyshee.com] [--out screenshots/source] [--limit 12]
 *
 * Reads URLs from data/page-inventory.csv (falls back to the base URL). Use
 * --base http://localhost:3000 --out screenshots/new to capture the new site.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { readCsv } from "../lib/csv";

const { values: args } = parseArgs({ options: { base: { type: "string", default: "https://sweetsbyshee.com" }, out: { type: "string", default: "screenshots/source" }, limit: { type: "string", default: "12" } } });
mkdirSync(args.out!, { recursive: true });
const base = new URL(args.base!);
const urls = existsSync("data/page-inventory.csv") && base.hostname !== "localhost"
  ? readCsv("data/page-inventory.csv").map((r) => r.url).slice(0, Number(args.limit))
  : [base.toString()];

const browser = await chromium.launch(process.env.HTTPS_PROXY && base.hostname !== "localhost" ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
for (const url of urls) {
  const name = new URL(url).pathname.replace(/^\/|\/$/g, "").replace(/[^a-z0-9]+/gi, "_") || "home";
  for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
    const page = await browser.newPage({ viewport });
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
      await page.screenshot({ path: `${args.out}/${name}-${label}.png`, fullPage: true });
      console.log(`✓ ${url} (${label})`);
    } catch (err) {
      console.warn(`✗ ${url} (${label}): ${(err as Error).message.split("\n")[0]}`);
    }
    await page.close();
  }
}
await browser.close();
