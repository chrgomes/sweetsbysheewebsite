import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { isoDaysFromNow, ORDER_MANAGER, signIn, SHOTS, trackErrors } from "./helpers";

test.describe.configure({ mode: "serial" });

let reference = "";
let requestLink = "";
let quoteLink = "";

const next = (page: Page) => page.getByRole("button", { name: /^(Continue|Review request)$/ }).click();

async function aboutYou(page: Page) {
  await page.getByLabel("Full name").fill("Riley Example");
  await page.getByRole("textbox", { name: "Email" }).fill("riley@example.com");
  await next(page);
}

async function event(page: Page) {
  await page.getByLabel("Event date").fill(isoDaysFromNow(30));
  await page.getByLabel("Occasion").selectOption("Birthday");
  if (!(await page.getByLabel("What would you like?").inputValue())) await page.getByLabel("What would you like?").selectOption("Sample Tiered Cake");
  await page.getByLabel("Servings or quantity").fill("30");
  await next(page);
}

async function design(page: Page, file?: string) {
  await page.getByLabel("Describe your design").fill("Two tiers with pressed edible flowers.");
  if (file) await page.getByLabel("Inspiration photos").setInputFiles(path.join("tests/fixtures", file));
  await next(page);
}

test("steps validate before advancing and keep progress in the tab", async ({ page }) => {
  await page.goto("/custom-orders");
  await expect(page.getByText("This is a request, not a confirmed order.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Step 1 of 5/ })).toBeVisible();
  await next(page);
  await expect(page.getByRole("heading", { name: /Step 1 of 5/ })).toBeVisible();
  await expect(page.getByLabel("Full name")).toBeFocused();
  await expect(page.locator("#customerName-error")).toBeVisible();

  // Choosing text contact makes the phone number required.
  await page.getByLabel("Full name").fill("Riley Example");
  await page.getByRole("textbox", { name: "Email" }).fill("riley@example.com");
  await page.getByRole("radio", { name: "Text message" }).check({ force: true });
  await next(page);
  await expect(page.locator("#customerPhone-error")).toContainText("phone number");
  await page.getByRole("radio", { name: "Email" }).check({ force: true });
  await next(page);

  await expect(page.getByRole("heading", { name: /Step 2 of 5/ })).toBeVisible();
  await expect(page.getByLabel("Number of tiers")).toHaveCount(0);
  await page.getByLabel("What would you like?").selectOption("Sample Tiered Cake");
  await expect(page.getByLabel("Number of tiers")).toBeVisible();
  await page.getByLabel("Servings or quantity").fill("40");

  // Reloading keeps what was typed (sessionStorage, this tab only).
  await page.reload();
  await expect(page.getByLabel("Full name")).toHaveValue("Riley Example");
  await expect(page.getByText(/restored what you entered/)).toBeVisible();
  await next(page);
  await expect(page.getByLabel("Servings or quantity")).toHaveValue("40");
  await page.screenshot({ path: `${SHOTS}/custom-order-form.png`, fullPage: true });
});

test("delivery needs an address; review shows everything and needs the acknowledgement", async ({ page }) => {
  await page.goto("/custom-orders");
  await aboutYou(page);
  await event(page);
  await design(page);
  await expect(page.getByLabel("Street address")).toHaveCount(0);
  await page.getByText("I'd like delivery").click();
  await expect(page.getByLabel("Street address")).toBeVisible();
  await next(page);
  await expect(page.locator("#line1-error")).toBeVisible();
  await page.getByText("I'll pick it up").click();
  await next(page);
  await expect(page.getByRole("heading", { name: /Review and send/ })).toBeVisible();
  await expect(page.getByText("Two tiers with pressed edible flowers.")).toBeVisible();
  await expect(page.getByText("riley@example.com")).toBeVisible();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(/confirm you understand/)).toBeVisible();
  // Edit jumps back to the step.
  await page.getByRole("button", { name: "Edit the design" }).click();
  await expect(page.getByLabel("Describe your design")).toBeVisible();
});

test("the server rejects files that aren't really images", async ({ page }) => {
  await page.goto("/custom-orders");
  await aboutYou(page);
  await event(page);
  await design(page, "not-an-image.jpg");
  await next(page);
  await page.getByRole("checkbox", { name: /I understand this is a request/ }).check();
  await page.waitForTimeout(3100); // the anti-spam token needs a few seconds
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(/isn't a supported image/).first()).toBeVisible();
  // The form jumps back to the step with the problem.
  await expect(page.getByRole("heading", { name: /The design/ })).toBeVisible();
});

test("successful request with an inspiration photo", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/products/sample-tiered-cake");
  await page.getByRole("link", { name: "Request a custom version" }).click();
  await aboutYou(page);
  await expect(page.getByLabel("What would you like?")).toHaveValue("Sample Tiered Cake");
  await event(page);
  await design(page, "inspiration.png");
  await next(page);
  await page.getByRole("checkbox", { name: /I understand this is a request/ }).check();
  await page.waitForTimeout(3100);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: /we've got your request/i })).toBeVisible();
  reference = (await page.locator("strong").first().textContent())!;
  expect(reference).toMatch(/^REQ-/);
  await page.screenshot({ path: `${SHOTS}/custom-order-thanks.png`, fullPage: true });
  await page.getByRole("link", { name: "View request status" }).click();
  await expect(page.getByRole("heading", { name: "Your custom request" })).toBeVisible();
  requestLink = page.url();
  // Without the token, nothing is shown.
  expect((await page.request.get(requestLink.split("?")[0])).status()).toBe(404);
  expect(errors).toEqual([]);
});

test("an order manager reviews the request and sends a quote; attachments are private", async ({ page, request }) => {
  const res = await request.get("/admin/inquiries", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(ORDER_MANAGER.email);
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("don't match an active account")).toBeVisible();
  await page.getByLabel("Password").fill(ORDER_MANAGER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Hello/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/admin-dashboard.png`, fullPage: true });

  await page.getByRole("link", { name: "Custom requests" }).first().click();
  await page.getByRole("link", { name: reference }).click();
  await expect(page.getByText("Riley Example").first()).toBeVisible();
  const img = page.getByRole("img", { name: /Inspiration photo/ });
  await expect(img).toBeVisible();
  const src = await img.getAttribute("src");
  const anon = await request.get(src!, { maxRedirects: 0 });
  expect(anon.status()).toBe(307);
  expect((await page.request.get(src!)).status()).toBe(200);

  // Build a quote: line items, then send.
  await page.getByLabel("Line 1 unit price").fill("abc");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Enter a price like 120.00.")).toBeVisible();
  await page.getByLabel("Line 1 unit price").fill("230");
  await page.getByRole("button", { name: "+ Add line" }).click();
  await page.getByLabel("Line 2 description").fill("Pressed flower decoration");
  await page.getByLabel("Line 2 unit price").fill("20");
  await expect(page.getByText("$270.00")).toBeVisible(); // preview: 250 + 8% tax
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Draft saved/)).toBeVisible();
  await page.getByRole("button", { name: "Send to customer" }).click();
  await expect(page.getByText("Sent — awaiting customer")).toBeVisible();
  quoteLink = (await page.getByText(/\/quotes\/QTE-/).textContent())!.trim();
  expect(quoteLink).toContain("?t=");
  await page.screenshot({ path: `${SHOTS}/admin-inquiry.png`, fullPage: true });
});

test("customer accepts the quote, pays the deposit, and the order is confirmed", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(requestLink);
  await expect(page.getByRole("link", { name: /quote/i }).first()).toBeVisible();
  await page.goto(quoteLink);
  await expect(page.getByRole("heading", { name: /Your quote/ })).toBeVisible();
  await expect(page.getByText("Pressed flower decoration")).toBeVisible();
  await expect(page.getByText("$270.00").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/customer-quote.png`, fullPage: true });
  await page.getByRole("checkbox", { name: /reviewed the quote/ }).check();
  await page.getByRole("button", { name: "Accept quote" }).click();

  // Demo settings ask for a 50% deposit.
  await expect(page.getByRole("heading", { name: "Pay $135.00" })).toBeVisible();
  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(page.getByText("Your order is confirmed.")).toBeVisible();
  await expect(page.getByText("Deposit paid", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Remaining balance/)).toContainText("$135.00");
  await page.screenshot({ path: `${SHOTS}/order-deposit-paid.png`, fullPage: true });
  expect(errors).toEqual([]);

  // The quote can't be accepted twice.
  await page.goto(quoteLink);
  await expect(page.getByRole("button", { name: "Accept quote" })).toHaveCount(0);
});

test("staff record the balance and move the order through production", async ({ page }) => {
  await signIn(page, ORDER_MANAGER);
  await page.goto("/admin/orders?status=balance");
  await page.getByRole("link", { name: /^SBS-/ }).first().click();
  await expect(page.getByText("Deposit paid").first()).toBeVisible();
  // Completing needs full payment.
  await page.getByLabel("Move to").selectOption("in_production");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByText(/Status updated/)).toBeVisible();
  await page.getByText("Record a payment received outside the website…").click();
  await page.getByLabel("Method").fill("Cash");
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Paid at pickup");
  await page.getByRole("button", { name: "Record payment" }).click();
  // Fully paid now, so the form is replaced by the recorded payment.
  await expect(page.getByText("Recorded payment")).toBeVisible();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/admin-order.png`, fullPage: true });
});
