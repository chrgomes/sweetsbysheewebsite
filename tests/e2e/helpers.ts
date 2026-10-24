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
