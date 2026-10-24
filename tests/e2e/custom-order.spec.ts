import { expect, test } from "@playwright/test";
import path from "node:path";
import { ADMIN, isoDaysFromNow, SHOTS, trackErrors } from "./helpers";


test.describe.configure({ mode: "serial" });

let reference = "";

test("validation and conditional fields", async ({ page }) => {
  await page.goto("/custom-orders");
  await expect(page.getByText("This is a request, not a confirmed order.")).toBeVisible();
  await expect(page.getByLabel("Number of tiers")).toHaveCount(0);
  await page.getByLabel("What would you like?").selectOption("Sample Tiered Cake");
  await expect(page.getByLabel("Number of tiers")).toBeVisible();
  await expect(page.getByLabel("Street address")).toHaveCount(0);
  await page.getByText("I'd like delivery").click();
  await expect(page.getByLabel("Street address")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/custom-order-form.png`, fullPage: true });
  await page.waitForTimeout(3100);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Please check the highlighted fields.")).toBeVisible();
  await expect(page.getByText("Please enter your name.")).toBeVisible();
  await expect(page.getByText("Please enter the delivery address.").or(page.getByText("Please enter a street address."))).toBeVisible();
  await expect(page.getByText(/confirm you understand/)).toBeVisible();
});

test("rejects files that aren't really images", async ({ page }) => {
  await page.goto("/custom-orders");
  await fillValid(page);
  await page.getByLabel("Inspiration photos").setInputFiles(path.join("tests/fixtures/not-an-image.jpg"));
  await page.waitForTimeout(3100);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(/isn't a supported image/).first()).toBeVisible();
});

test("successful request with an inspiration photo", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/products/sample-tiered-cake");
  await page.getByRole("link", { name: "Request a custom version" }).click();
  await expect(page.getByLabel("What would you like?")).toHaveValue("Sample Tiered Cake");
  await fillValid(page);
  await page.getByLabel("Inspiration photos").setInputFiles(path.join("tests/fixtures/inspiration.png"));
  await page.waitForTimeout(3100);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: /we've got your request/i })).toBeVisible();
  reference = (await page.locator("strong").first().textContent())!;
  expect(reference).toMatch(/^REQ-/);
  await page.screenshot({ path: `${SHOTS}/custom-order-thanks.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("admin can review the request; attachments are private", async ({ page, request }) => {
  // Not signed in: admin and attachment URLs are protected.
  const res = await request.get("/admin/inquiries", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("don't match an active account")).toBeVisible();
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Hello/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/admin-dashboard.png`, fullPage: true });

  await page.getByRole("link", { name: "Custom requests" }).first().click();
  await page.getByRole("link", { name: reference }).click();
  await expect(page.getByText("Riley Example")).toBeVisible();
  const img = page.getByRole("img", { name: /Inspiration photo/ });
  await expect(img).toBeVisible();
  const src = await img.getAttribute("src");
  const anon = await request.get(src!, { maxRedirects: 0 }); // no admin cookie
  expect(anon.status()).toBe(307);
  expect(anon.headers()["content-type"] ?? "").not.toContain("image");
  expect((await page.request.get(src!)).status()).toBe(200); // with admin cookie

  await page.getByLabel("Status").selectOption("quoted");
  await page.getByLabel("Agreed / quoted price (before tax)").fill("250");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.getByRole("button", { name: "Create order" }).click();
  await expect(page.getByText("Converted.")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/admin-inquiry.png`, fullPage: true });
  await page.getByRole("link", { name: "View order →" }).click();
  await expect(page.getByText("$270.00")).toBeVisible(); // 250 + 8% tax, pickup
});

async function fillValid(page: import("@playwright/test").Page) {
  await page.getByLabel("Full name").fill("Riley Example");
  await page.getByLabel("Email").fill("riley@example.com");
  await page.getByLabel("Event date").fill(isoDaysFromNow(30));
  await page.getByLabel("Occasion").selectOption("Birthday");
  if (!(await page.getByLabel("What would you like?").inputValue())) await page.getByLabel("What would you like?").selectOption("Sample Tiered Cake");
  await page.getByLabel("Servings or quantity").fill("30");
  await page.getByLabel("Describe your design").fill("Two tiers with pressed edible flowers.");
  await page.getByRole("checkbox", { name: /I understand this is a request/ }).check();
}
