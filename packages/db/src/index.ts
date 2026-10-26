import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.js";

export { analysisRepository } from "./analyses.js";
export { ProjectError, projectRepository } from "./projects.js";
export { schema };
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10_000,
    query_timeout: 5000,
    statement_timeout: 5000,
  });
  // A sleeping/disconnected managed database must not crash the API on an idle socket.
  pool.on("error", () => {});
  // Checked-out clients no longer have the pool's idle error listener. A dropped
  // transaction socket can emit an error between query rejection and rollback;
  // handle that event without logging its potentially sensitive database details.
  // Pending queries still reject and pg removes unusable clients on release.
  pool.on("connect", (client) => client.on("error", () => {}));
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    async readiness() {
      // Probe the migrated schema as well as connectivity.
      await pool.query('SELECT 1 FROM "user" LIMIT 0');
      await pool.query('SELECT 1 FROM "session" LIMIT 0');
      await pool.query('SELECT 1 FROM "project" LIMIT 0');
      await pool.query('SELECT 1 FROM "project_file" LIMIT 0');
      await pool.query('SELECT 1 FROM "project_snapshot" LIMIT 0');
      await pool.query('SELECT assets FROM "project_snapshot" LIMIT 0');
      await pool.query('SELECT 1 FROM "project_asset" LIMIT 0');
      await pool.query('SELECT 1 FROM "snapshot_name" LIMIT 0');
      await pool.query('SELECT 1 FROM "ai_proposal" LIMIT 0');
      await pool.query('SELECT 1 FROM "resume_analysis" LIMIT 0');
    },
    migrate: () =>
      migrate(db, {
        migrationsFolder: fileURLToPath(
          new URL("../migrations", import.meta.url),
        ),
      }),
    close: () => pool.end(),
  };
}
export type Database = ReturnType<typeof createDatabase>;
