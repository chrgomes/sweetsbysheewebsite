/**
 * Lab performance check with Playwright: mobile viewport, 4× CPU slowdown and
 * a throttled network. Reports LCP, CLS, long-task blocking time, and bytes
 * of JavaScript per page.
 *
 *   pnpm build && pnpm start   # in another terminal
 *   pnpm audit:perf [--base http://localhost:3000]
 *
 * Lab numbers are a guide; confirm with field data (Search Console / CrUX) after launch.
 */
import { chromium } from "@playwright/test";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({ options: { base: { type: "string", default: "http://localhost:3000" } } });
const paths = ["/", "/shop", "/products/sample-celebration-cake", "/custom-orders", "/cart"];
const browser = await chromium.launch();
console.log("page".padEnd(38), "LCP ms".padStart(8), "CLS".padStart(6), "TBT ms".padStart(8), "JS KB".padStart(7), "total KB".padStart(9));
for (const path of paths) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  let js = 0;
  let total = 0;
  page.on("response", async (r) => {
    const len = Number(r.headers()["content-length"] ?? 0) || (await r.body().catch(() => Buffer.alloc(0))).length;
    total += len;
    if (r.request().resourceType() === "script") js += len;
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __lcp: number; __cls: number; __tbt: number };
    w.__lcp = 0;
    w.__cls = 0;
    w.__tbt = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (w.__lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => !(e as unknown as { hadRecentInput: boolean }).hadRecentInput && (w.__cls += (e as unknown as { value: number }).value))).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (w.__tbt += Math.max(0, e.duration - 50)))).observe({ type: "longtask", buffered: true });
  });
  await page.goto(args.base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const m = await page.evaluate(() => {
    const w = window as unknown as { __lcp: number; __cls: number; __tbt: number };
    return { lcp: w.__lcp, cls: w.__cls, tbt: w.__tbt };
  });
  console.log(path.padEnd(38), m.lcp.toFixed(0).padStart(8), m.cls.toFixed(3).padStart(6), m.tbt.toFixed(0).padStart(8), (js / 1024).toFixed(0).padStart(7), (total / 1024).toFixed(0).padStart(9));
  await context.close();
}
await browser.close();
