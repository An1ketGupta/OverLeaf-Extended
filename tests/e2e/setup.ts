import { createDatabase } from "@overleaf-pro/db";
import { verifyCompilerAssets } from "../../scripts/compiler-checks.js";
import { requireTestDatabase } from "../../scripts/test-database.js";

export default async function setup() {
  if (process.env.CI || process.env.REQUIRE_COMPILER_TESTS === "true") {
    requireTestDatabase();
    await verifyCompilerAssets();
  }
  if (!process.env.TEST_DATABASE_URL) return;
  const database = createDatabase(requireTestDatabase());
  try {
    await database.migrate();
  } finally {
    await database.close();
  }
}
