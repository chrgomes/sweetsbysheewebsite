import type { Page } from "@playwright/test";

export const SHOTS = process.env.SCREENSHOT_DIR ?? "screenshots";

/** Fail the test on uncaught page errors or console errors. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

export function isoDaysFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Created by scripts/dev/e2e-setup.sh. */
export const ADMIN = { email: "e2e-owner@example.com", password: "e2e-password-123456" };
/** Production staff: can view orders and move them through production only. */
export const PRODUCTION = { email: "e2e-production@example.com", password: "e2e-password-654321" };

export async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: /Hello/ }).waitFor();
}
/** Order manager: requests, quotes, payments and production, but not settings or refunds. */
export const ORDER_MANAGER = { email: "e2e-orders@example.com", password: "e2e-password-orders-1" };
/** Read-only / reporting: sees reports, stock and costs; changes nothing. */
export const REPORTING = { email: "e2e-reports@example.com", password: "e2e-password-reports-1" };
