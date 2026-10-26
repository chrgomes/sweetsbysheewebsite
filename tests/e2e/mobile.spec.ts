import { expect, test } from "@playwright/test";
import { SHOTS } from "./helpers";

for (const path of ["/", "/shop", "/products/sample-celebration-cake", "/collections/sample-collection", "/custom-orders", "/cart", "/checkout", "/faq", "/contact", "/orders/find"]) {
  test(`no horizontal scroll on ${path}`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("mobile menu opens, traps focus and closes with Escape", async ({ page }) => {
  await page.goto("/");
  await page.screenshot({ path: `${SHOTS}/home-mobile.png`, fullPage: true });
  const toggle = page.getByRole("button", { name: "Open menu" });
  await toggle.click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/menu-mobile.png` });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  await page.getByRole("button", { name: "Open menu" }).click();
  await menu.getByRole("link", { name: "Shop" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(menu).toBeHidden();
});

test("mobile product and custom-order screenshots", async ({ page }) => {
  await page.goto("/products/sample-celebration-cake");
  await page.screenshot({ path: `${SHOTS}/product-mobile.png`, fullPage: true });
  await page.goto("/custom-orders");
  await page.screenshot({ path: `${SHOTS}/custom-order-mobile.png`, fullPage: true });
});
