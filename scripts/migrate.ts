import { createDatabase } from "@overleaf-pro/db";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "Set DATABASE_URL (or DATABASE_MIGRATION_URL) before running migrations.",
  );
const database = createDatabase(url);
try {
  await database.migrate();
  console.log("Database migrations applied.");
} catch {
  console.error(
    "Migration failed. Check database access and migration configuration.",
  );
  process.exitCode = 1;
} finally {
  await database.close();
}
