import { expect, test } from "@playwright/test";
import { isoDaysFromNow, REPORTING, SHOTS, signIn } from "./helpers";

test("a paid order shows up in the ingredient forecast and the sales report", async ({ page, browser }) => {
  // A customer buys two 8" cakes (the demo 8" uses 1.5× the recipe).
  await page.goto("/products/sample-celebration-cake");
  await page.getByText('8" round').click();
  await page.getByText("Sample vanilla").click();
  await page.getByRole("button", { name: "Increase quantity" }).click();
  await expect(async () => {
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByText("Added 2 to your cart.")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.goto("/checkout");
  await page.getByLabel("Full name").fill("Robin Report");
  await page.getByLabel("Email").fill("robin@example.com");
  // This product offers both; submitting without a choice asks for one.
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByText("Please choose pickup or delivery.")).toBeVisible();
  await page.getByRole("radio", { name: /^Pickup/ }).check({ force: true });
  await page.getByLabel("Pickup date").fill(isoDaysFromNow(6));
  await page.getByLabel("Time").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(page.getByText("Your order is confirmed.")).toBeVisible();

  const ctx = await browser.newContext();
  const staff = await ctx.newPage();
  await signIn(staff, REPORTING);

  // 2 cakes × 1.5 × 300 g flour = 900 g
  await staff.goto(`/admin/inventory/forecast?from=${isoDaysFromNow(0)}&to=${isoDaysFromNow(13)}`);
  const flour = staff.getByRole("row").filter({ hasText: "Sample flour" });
  await expect(flour.getByRole("cell").nth(1)).toHaveText("900 g");
  await expect(flour.getByRole("cell").nth(2)).toHaveText("10,000 g"); // demo delivery
  await expect(flour.getByRole("cell").nth(3)).toHaveText("9,100 g");
  await staff.screenshot({ path: `${SHOTS}/admin-forecast.png`, fullPage: true });

  // Sales: 2 × $60.00; cost 2 × 1.5 × $4.83 = $14.49
  await staff.goto("/admin/reports");
  const cake = staff.getByRole("row").filter({ hasText: "Sample Celebration Cake" });
  await expect(cake.getByRole("cell").nth(2)).toHaveText("2");
  await expect(cake.getByRole("cell").nth(3)).toHaveText("$120.00");
  await expect(cake.getByRole("cell").nth(5)).toHaveText("$14.49");
  await expect(staff.getByRole("list", { name: "Revenue by day" })).toBeVisible();
  await staff.screenshot({ path: `${SHOTS}/admin-reports.png`, fullPage: true });

  // Reporting is read-only: no stock forms.
  await staff.goto("/admin/inventory");
  await staff.getByRole("link", { name: "Sample flour" }).click();
  await expect(staff.getByRole("button", { name: "Add to stock" })).toHaveCount(0);
  await ctx.close();
});
