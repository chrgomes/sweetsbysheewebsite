import { expect, test } from "@playwright/test";
import { ADMIN, SHOTS } from "./helpers";


test.beforeEach(async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Hello/ })).toBeVisible();
});

test("owner creates a product with options and photo; the storefront shows it", async ({ page }) => {
  await page.getByRole("link", { name: "Products", exact: true }).click();
  await page.getByRole("link", { name: "New product" }).click();
  await page.getByLabel("Name").fill("E2E Lemon Loaf");
  await page.locator("#status").selectOption("active");
  await page.getByLabel("Base price ($)").fill("abc");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByText("Enter a price like 45 or 45.00.")).toBeVisible();
  await page.getByLabel("Base price ($)").fill("26.50");
  await page.getByLabel("Sell through online checkout").check();
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByText("Product created. Add options and photos below.")).toBeVisible();

  await page.getByRole("button", { name: "+ Add option" }).click();
  await page.getByPlaceholder("e.g. Size").fill("Size");
  await page.getByLabel("Choice label").last().fill("Mini");
  await page.getByRole("button", { name: "+ Add choice" }).click();
  await page.getByLabel("Choice label").last().fill("Large");
  await page.getByLabel("Price change").last().fill("10");
  await page.getByRole("button", { name: "Save options" }).click();
  await expect(page.getByText("Options saved.")).toBeVisible();

  await page.getByLabel("Photo file").setInputFiles("tests/fixtures/inspiration.png");
  await page.getByPlaceholder(/Two-tier white cake/).fill("Sliced lemon loaf on a plate");
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("Photo added.")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/admin-product.png`, fullPage: true });

  await page.goto("/products/e2e-lemon-loaf");
  await expect(page.getByRole("heading", { name: "E2E Lemon Loaf" })).toBeVisible();
  await expect(page.getByText("$26.50").first()).toBeVisible();
  await page.getByText("Large").click();
  await expect(page.getByText("$36.50").first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Sliced lemon loaf on a plate" }).first()).toBeVisible();

  await page.goto("/admin/audit");
  await expect(page.getByText("product.created").first()).toBeVisible();
  await expect(page.getByText("product.options_updated").first()).toBeVisible();
});

test("settings validation and checkout switch", async ({ page }) => {
  await page.goto("/admin/settings");
  await page.getByLabel("Sales tax rate (%)").fill("abc");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(/Enter the tax rate as a percentage/)).toBeVisible();
});

test("signed-out visitors can't call admin pages", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const path of ["/admin", "/admin/orders", "/admin/settings", "/admin/products/new"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/login$/);
  }
  // A forged cookie is not a session.
  await ctx.addCookies([{ name: "sbs_admin", value: "forged", url: "http://localhost:3100" }]);
  await page.goto("/admin/orders");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await ctx.close();
});
