import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
});
