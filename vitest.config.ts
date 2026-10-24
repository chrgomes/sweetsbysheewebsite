import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // "server-only" throws outside React Server Components; tests run server code directly.
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    setupFiles: ["tests/support/setup.ts"],
    // Integration tests share one database; run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      APP_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://sweets@127.0.0.1:54329/sweets_test",
      EMAIL_PROVIDER: "memory",
      PAYMENTS_PROVIDER: "fake",
      STORAGE_DIR: path.resolve(import.meta.dirname, "storage-test"),
      APP_SECRET: "test-secret-0123456789abcdef",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      BUSINESS_NOTIFICATION_EMAIL: "owner@example.test",
    },
  },
});
