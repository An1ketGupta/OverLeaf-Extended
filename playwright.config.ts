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
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm dev:api",
      url: "http://127.0.0.1:3001/api/health",
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: testDatabase ?? "",
        AUTH_SECRET: randomBytes(32).toString("hex"),
        AUTH_ALLOW_SIGNUP: "true",
        APP_ORIGIN: "http://127.0.0.1:5173",
        TRUSTED_ORIGINS: "http://127.0.0.1:5173",
      },
    },
    {
      command: "pnpm dev:web",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
    },
  ],
});
