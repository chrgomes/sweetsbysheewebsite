import { expect, test } from "@playwright/test";
import { isoDaysFromNow, SHOTS, trackErrors } from "./helpers";

test("home page renders key sections and every internal link resolves", async ({ page, request }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Customer favourites" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something made just for you" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/home-desktop.png`, fullPage: true });

  const hrefs = await page.locator("a[href^='/']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")!))]);
  expect(hrefs.length).toBeGreaterThan(10);
  for (const href of hrefs) {
    const res = await request.get(href, { maxRedirects: 0 });
    expect(res.status(), href).toBeLessThan(400);
  }
  expect(errors).toEqual([]);
});

test("catalogue: categories, product details, SEO metadata", async ({ page }) => {
  await page.goto("/shop");
  await expect(page.getByRole("heading", { name: "Shop our treats" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/shop-desktop.png`, fullPage: true });
  await page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: "Sample Treats" }).click();
  await expect(page).toHaveURL(/\/shop\/sample-treats$/);
  await expect(page.getByRole("link", { name: "Sample Cupcake Box" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sample Celebration Cake" })).toHaveCount(0);

  await page.goto("/products/sample-celebration-cake");
  await expect(page).toHaveTitle("Sample Celebration Cake | Sweets by Shyee");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "http://localhost:3100/products/sample-celebration-cake");
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld.some((t) => t.includes('"@type":"Product"') && t.includes('"price":"45.00"'))).toBe(true);
  await expect(page.getByText('10" round')).toHaveCSS("text-decoration-line", "line-through");
  await expect(page.getByText("Photo coming soon").first()).toBeVisible(); // graceful image fallback
  await page.screenshot({ path: `${SHOTS}/product-desktop.png`, fullPage: true });
});

test("unavailable products can't be added to the cart", async ({ page }) => {
  await page.goto("/products/sample-seasonal-treat");
  await expect(page.getByText("This item is currently unavailable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to cart" })).toHaveCount(0);
});

test("required options are enforced before adding to cart", async ({ page }) => {
  await page.goto("/products/sample-celebration-cake");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText(/Please choose a size and a flavour/)).toBeVisible();
});

test("full purchase: options, cart, checkout, payment, confirmation", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/products/sample-celebration-cake");
  await page.getByText('8" round').click();
  await page.getByText("Sample lemon").click();
  await expect(page.getByText("$63.00").first()).toBeVisible(); // 45 + 15 + 3
  await page.getByRole("button", { name: "Increase quantity" }).click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added 2 to your cart.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cart, 2 items" })).toBeVisible();

  await page.goto("/products/sample-cupcake-box");
  await page.getByText("12 pieces").click();
  await page.getByRole("button", { name: "Add to cart" }).click();

  await page.goto("/cart");
  await expect(page.getByText("$126.00")).toBeVisible();
  await expect(page.getByText("$170.00")).toBeVisible(); // subtotal 126 + 44
  await page.screenshot({ path: `${SHOTS}/cart-desktop.png`, fullPage: true });

  // Quantity changes update the server-priced subtotal.
  await page.getByRole("group", { name: "Quantity for Sample Cupcake Box" }).getByRole("button", { name: "Increase quantity" }).click();
  await expect(page.getByText("$214.00")).toBeVisible();
  await page.getByRole("group", { name: "Quantity for Sample Cupcake Box" }).getByRole("button", { name: "Decrease quantity" }).click();
  await expect(page.getByText("$170.00")).toBeVisible();

  await page.getByRole("link", { name: "Continue to checkout" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  // Cupcakes are pickup-only, so only pickup is offered.
  await expect(page.getByText("Delivery", { exact: true })).toHaveCount(0);

  // Submitting empty shows field errors.
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByText("Please enter your name.")).toBeVisible();

  await page.getByLabel("Full name").fill("Avery Tester");
  await page.getByLabel("Email").fill("avery@example.com");
  await page.getByLabel("Pickup date").fill(isoDaysFromNow(1));
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.locator("#fulfillmentDate-error")).toContainText("notice");

  await page.getByLabel("Pickup date").fill(isoDaysFromNow(6));
  await expect(page.getByText("$183.60")).toBeVisible(); // 170 + 8% tax
  await page.screenshot({ path: `${SHOTS}/checkout-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Continue to payment" }).click();

  await expect(page.getByRole("heading", { name: "Pay $183.60" })).toBeVisible();
  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(page.getByRole("heading", { name: "Thank you, Avery!" })).toBeVisible();
  await expect(page.getByText("Paid — confirmed")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/order-confirmation.png`, fullPage: true });
  await expect(page.getByRole("link", { name: "Cart, empty" })).toBeVisible();

  // The status page needs the secret token.
  const noToken = page.url().split("?")[0];
  expect((await page.request.get(noToken)).status()).toBe(404);
  expect(errors).toEqual([]);
});

test("failed payment leaves the order unpaid and the cart intact", async ({ page }) => {
  await page.goto("/products/sample-cupcake-box");
  await page.getByText("6 pieces").click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.goto("/checkout");
  await page.getByLabel("Full name").fill("Fail Case");
  await page.getByLabel("Email").fill("fail@example.com");
  await page.getByLabel("Pickup date").fill(isoDaysFromNow(6));
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: "Simulate failed payment" }).click();
  await expect(page.getByRole("heading", { name: "This order wasn't completed" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cart, 1 item" })).toBeVisible();
});

test("tampered cart contents are rejected by the server", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("sbs-cart-v1", JSON.stringify([{ productId: "00000000-0000-4000-8000-000000000000", optionValueIds: [], quantity: 1 }])));
  await page.goto("/cart");
  await expect(page.getByText("This item is no longer available.")).toBeVisible();
  await expect(page.getByText("Please remove unavailable items before checking out.")).toBeVisible();
});

test("keyboard: skip link and visible focus", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("robots blocks indexing outside production", async ({ request }) => {
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/products/sample-celebration-cake");
  expect(sitemap).not.toContain("sample-seasonal-treat-draft");
});
