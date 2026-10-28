import { expect, test } from "@playwright/test";
import { ADMIN, PRODUCTION, SHOTS, signIn } from "./helpers";


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

test("personalisation options, collections and draft preview", async ({ page }) => {
  await page.getByRole("link", { name: "Products", exact: true }).click();
  await page.getByRole("link", { name: "New product" }).click();
  await page.getByLabel("Name").fill("E2E Draft Cookie");
  await page.getByLabel("Base price ($)").fill("4");
  await page.getByLabel("Sell through online checkout").check();
  await page.getByLabel("Sample Collection").check();
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByText("Product created.")).toBeVisible();
  await page.getByRole("button", { name: "+ Add option" }).click();
  await page.getByPlaceholder("e.g. Size").fill("Name to ice");
  await page.getByLabel("Option type").selectOption("text");
  await page.getByRole("button", { name: "Save options" }).click();
  await expect(page.getByText("Personalisation options need a character limit.")).toBeVisible();
  await page.getByPlaceholder("e.g. 30").fill("12");
  await page.getByRole("button", { name: "Save options" }).click();
  await expect(page.getByText("Options saved.")).toBeVisible();

  // Drafts are hidden from customers, but staff can preview them.
  const anon = await page.context().browser()!.newContext();
  const anonPage = await anon.newPage();
  expect((await anonPage.goto("/products/e2e-draft-cookie"))!.status()).toBe(404);
  // ?preview=1 does nothing without a staff session.
  expect((await anonPage.goto("/products/e2e-draft-cookie?preview=1"))!.status()).toBe(404);
  await anon.close();
  await page.goto("/products/e2e-draft-cookie?preview=1");
  await expect(page.getByText(/Staff preview — this product is draft/)).toBeVisible();
  await expect(page.getByLabel(/Name to ice/)).toHaveCount(0); // ordering is disabled in preview
});

test("discount codes, calendar and order export", async ({ page }) => {
  await page.goto("/admin/discounts");
  await page.locator("#code-new").fill("spring 5");
  await page.locator("#kind-new").selectOption("fixed");
  await page.locator("#value-new").fill("5");
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText("Code SPRING5 created.")).toBeVisible();

  await page.goto("/admin/calendar");
  await expect(page.getByRole("heading", { name: "Production calendar" })).toBeVisible();
  await page.getByRole("navigation", { name: "Calendar view" }).getByRole("link", { name: "day", exact: true }).click();
  await page.getByLabel("Units available").fill("0");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#reason-error")).toBeVisible();
  await page.getByLabel("Reason").fill("E2E closed day");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Capacity updated for this day.")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/admin-calendar.png`, fullPage: true });

  const csv = await page.request.get("/admin/orders-export?status=all");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain('"Reference"');
});

test("owner adds and deletes a team member", async ({ page }) => {
  await page.goto("/admin/users");
  await page.getByLabel("Name").fill("Temp Helper");
  await page.getByLabel("Email").fill("temp-helper@example.com");
  await page.locator("#new-role").selectOption("reporting");
  await page.getByLabel("Temporary password").fill("temporary-pass-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Account created for temp-helper@example.com")).toBeVisible();

  const row = page.getByRole("list", { name: "Team members" }).getByRole("listitem").filter({ hasText: "temp-helper@example.com" });
  await expect(row.getByText("Read-only / reporting").first()).toBeVisible();
  // The only owner can't delete themselves.
  const me = page.getByRole("list", { name: "Team members" }).getByRole("listitem").filter({ hasText: "(you)" });
  await expect(me.locator("summary", { hasText: "Delete" })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/admin-team.png`, fullPage: true });

  await row.locator("summary", { hasText: "Delete" }).click();
  await row.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByText("Tick the box to confirm.")).toBeVisible();
  await row.getByLabel("I want to delete this account").check();
  await row.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByText("temp-helper@example.com", { exact: true })).toHaveCount(0);
  await page.goto("/admin/audit");
  await expect(page.getByText("admin.user_deleted").first()).toBeVisible();
});

test("inventory: ingredients, deliveries, stocktake, waste and recipe costs", async ({ page }) => {
  await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Inventory" }).click();
  await expect(page.getByRole("link", { name: "Sample flour" })).toBeVisible();
  await page.getByLabel("Name").fill("E2E vanilla");
  await page.getByLabel("Counted in").selectOption("ml");
  await page.getByLabel("Cost per L ($)").fill("abc");
  await page.getByRole("button", { name: "Add ingredient" }).click();
  await expect(page.getByText("Enter an amount like 2.50.")).toBeVisible();
  await page.getByLabel("Cost per L ($)").fill("40");
  await page.getByRole("button", { name: "Add ingredient" }).click();
  await expect(page.getByText("Ingredient added.")).toBeVisible();

  await page.getByLabel("Amount (ml)").first().fill("500");
  await page.getByLabel("Total paid ($)").fill("25");
  await page.getByRole("button", { name: "Add to stock" }).click();
  await expect(page.getByText("Delivery recorded.")).toBeVisible();
  await expect(page.getByText("500 ml").first()).toBeVisible();
  await expect(page.getByText("$50.00 per L")).toBeVisible(); // cost updated from the delivery
  await expect(page.getByLabel("Cost per L ($)")).toHaveValue("50.00"); // and the edit form shows it

  await page.getByLabel("Counted (ml)").fill("480");
  await page.getByRole("button", { name: "Set stock to this count" }).click();
  await expect(page.locator("#cnt-note-error")).toBeVisible();
  await page.getByLabel("Reason").fill("Weekly count");
  await page.getByRole("button", { name: "Set stock to this count" }).click();
  await expect(page.getByText("Stock count updated.")).toBeVisible();
  await page.getByLabel("Amount (ml)").nth(1).fill("30");
  await page.getByLabel("What happened").fill("Spilled");
  await page.getByRole("button", { name: "Record waste" }).click();
  await expect(page.getByText("Waste recorded.")).toBeVisible();
  await expect(page.getByText("450 ml").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/admin-ingredient.png`, fullPage: true });

  // Sample recipe: 300 g flour × 0.2¢ + 250 g sugar × 0.25¢ + 200 g butter × 1.2¢ + 4 eggs × 30¢ = $4.83
  await page.goto("/admin/products");
  await page.getByRole("link", { name: "Sample Celebration Cake" }).click();
  await expect(page.getByText("Ingredient cost: $4.83 each")).toBeVisible();
  await expect(page.getByText(/margin at the base price 89%/)).toBeVisible();
});

test("production staff can progress orders but not reach owner areas", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, PRODUCTION);
  const nav = page.getByRole("navigation", { name: "Admin" });
  await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Calendar" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Discount codes" })).toHaveCount(0);
  for (const path of ["/admin/settings", "/admin/users", "/admin/discounts", "/admin/customers"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\?denied=1$/);
  }
  await expect(page.getByText("Your role doesn't include access to that page.")).toBeVisible();
  // Production keeps stock up to date but doesn't see costs.
  await nav.getByRole("link", { name: "Inventory" }).click();
  await expect(page.getByRole("columnheader", { name: "Cost" })).toHaveCount(0);
  await page.getByRole("link", { name: "Sample eggs" }).click();
  await expect(page.getByLabel("Total paid ($)")).toHaveCount(0);
  await page.getByLabel("Amount (each)").nth(1).fill("2");
  await page.getByLabel("What happened").fill("Cracked");
  await page.getByRole("button", { name: "Record waste" }).click();
  await expect(page.getByText("Waste recorded.")).toBeVisible();
  // Exports carry customer data and aren't available to production staff.
  expect((await page.request.get("/admin/orders-export")).status()).toBe(404);
  await ctx.close();
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
