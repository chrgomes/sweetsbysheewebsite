import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
const env = {
  NODE_ENV: "production",
  APP_ENV: "test",
  NEXT_PUBLIC_SITE_URL: baseURL,
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://sweets@127.0.0.1:54329/sweets_e2e",
  PAYMENTS_PROVIDER: "fake",
  EMAIL_PROVIDER: "console",
  STORAGE_DIR: "./storage-e2e",
  APP_SECRET: "e2e-secret-0123456789abcdef",
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    // Set E2E_SKIP_BUILD=1 to reuse an existing .next build.
    command: `./scripts/dev/e2e-setup.sh && ${process.env.E2E_SKIP_BUILD ? "" : "pnpm build && "}pnpm start -p ${PORT}`,
    url: baseURL,
    timeout: 300_000,
    reuseExistingServer: false,
    env,
  },
});
