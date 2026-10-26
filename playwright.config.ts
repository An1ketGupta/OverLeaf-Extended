import "dotenv/config";
import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { requireTestDatabase } from "./scripts/test-database.js";

const testDatabase = process.env.TEST_DATABASE_URL
  ? requireTestDatabase()
  : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/setup.ts",
  fullyParallel: false,
  // All suites share one loopback API/auth rate-limit bucket; compiler jobs also
  // retain substantial browser memory. Serialize real browser workflows.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:5273", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec tsx scripts/recovery-server.ts",
      url: "http://127.0.0.1:3101/api/health",
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: testDatabase ?? "",
        AUTH_SECRET: randomBytes(32).toString("hex"),
        AUTH_ALLOW_SIGNUP: "true",
        MAIL_ENABLED: "true",
        PORT: "3101",
        APP_ORIGIN: "http://127.0.0.1:5273",
        TRUSTED_ORIGINS: "http://127.0.0.1:5273",
      },
    },
    {
      command:
        "pnpm --filter @overleaf-pro/web dev --port 5273 --host 127.0.0.1",
      url: "http://127.0.0.1:5273",
      env: { API_ORIGIN: "http://127.0.0.1:3101" },
      reuseExistingServer: false,
    },
  ],
});
