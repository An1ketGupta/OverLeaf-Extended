import { createDatabase, schema } from "@overleaf-pro/db";

if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL before seeding.");
const database = createDatabase(process.env.DATABASE_URL);
try {
  await database.db
    .insert(schema.appMetadata)
    .values({ key: "foundation.version", value: "0" })
    .onConflictDoNothing();
  console.log(
    "Foundation metadata seeded. No users, passwords, or private projects were created.",
  );
} catch {
  console.error(
    "Seed failed. Apply migrations first and check database access.",
  );
  process.exitCode = 1;
} finally {
  await database.close();
}
