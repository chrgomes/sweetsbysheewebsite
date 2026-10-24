import { describe, expect, it } from "vitest";
import { extractPage, normalizeUrl, parsePrice, robotsAllows } from "../../scripts/lib/extract";

describe("audit extraction", () => {
  it("parses only unambiguous prices", () => {
    expect(parsePrice("$1,250.00")).toEqual({ amount: 1250, currency: "USD" });
    expect(parsePrice("18")).toEqual({ amount: 18, currency: null });
    expect(parsePrice("$40 – $75")).toBeNull();
    expect(parsePrice("40–75")).toBeNull();
    expect(parsePrice("Price on request")).toBeNull();
  });
  it("normalises URLs and strips tracking parameters", () => {
    expect(normalizeUrl("/menu/?utm_source=x#top", "https://a.test/")).toBe("https://a.test/menu");
    expect(normalizeUrl("javascript:alert(1)", "https://a.test/")).toBeNull();
  });
  it("applies robots.txt rules", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$";
    expect(robotsAllows(robots, "/menu")).toBe(true);
    expect(robotsAllows(robots, "/private/x")).toBe(false);
    expect(robotsAllows(robots, "/private/ok/page")).toBe(true);
    expect(robotsAllows(robots, "/menu.pdf")).toBe(false);
  });
  it("extracts structured products, images and contacts without executing anything", () => {
    const html = `<html><head><title> Cake </title><script type="application/ld+json">{"@type":"Product","name":"Cake","offers":{"@type":"AggregateOffer","lowPrice":"40","highPrice":"75"}}</script></head>
      <body><h1>Cake</h1><img src="/a.jpg" srcset="/a-400.jpg 400w, /a-1600.jpg 1600w" alt="A cake"><div style="background-image:url('/bg.jpg')"></div>
      <a href="mailto:Hi@Shop.test">mail</a><a href="tel:+1 555 0100">call</a><a href="https://instagram.com/x">ig</a><script>window.evil=1</script></body></html>`;
    const page = extractPage(html, "https://a.test/products/cake", "https://a.test");
    expect(page.title).toBe("Cake");
    expect(page.pageType).toBe("product");
    expect(page.products[0]).toMatchObject({ name: "Cake", price: null, priceText: "40–75" });
    expect(page.images.map((i) => i.url)).toEqual(expect.arrayContaining(["https://a.test/a.jpg", "https://a.test/a-1600.jpg", "https://a.test/bg.jpg"]));
    expect(page.emails).toEqual(["hi@shop.test"]);
    expect(page.phones).toEqual(["+1 555 0100"]);
    expect(page.socialLinks).toEqual(["https://instagram.com/x"]);
    expect(page.textBlocks.join(" ")).not.toContain("window.evil");
  });
});
