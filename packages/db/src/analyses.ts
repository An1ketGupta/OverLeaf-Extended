import { randomUUID } from "node:crypto";
import {
  type ResumeInput,
  type ResumeReport,
  savedResumeSchema,
} from "@overleaf-pro/contracts";
import type pg from "pg";
import { ProjectError } from "./projects.js";

export function analysisRepository(pool: pg.Pool) {
  return {
    async save(userId: string, input: ResumeInput, report: ResumeReport) {
      const data = savedResumeSchema.parse({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        input,
        report,
        attestation: "client-provided-extraction",
      });
      const bytes = Buffer.byteLength(JSON.stringify(data));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
          userId,
        ]);
        const usage = (
          await client.query<{ count: number; bytes: string }>(
            "SELECT count(*)::int AS count, COALESCE(sum(bytes),0)::text AS bytes FROM resume_analysis WHERE user_id = $1",
            [userId],
          )
        ).rows[0];
        if (
          (usage?.count ?? 0) >= 20 ||
          Number(usage?.bytes ?? 0) + bytes > 8 * 1024 * 1024
        )
          throw new ProjectError(
            400,
            "Saved report limit reached. Delete older reports first.",
          );
        await client.query(
          "INSERT INTO resume_analysis (id,user_id,data,bytes) VALUES ($1,$2,$3::jsonb,$4)",
          [data.id, userId, JSON.stringify(data), bytes],
        );
        await client.query("COMMIT");
        return data;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async list(userId: string) {
      const rows = (
        await pool.query<{ id: string; createdAt: Date }>(
          'SELECT id, created_at AS "createdAt" FROM resume_analysis WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
          [userId],
        )
      ).rows;
      return rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
      }));
    },
    async get(userId: string, id: string) {
      const row = (
        await pool.query<{ data: unknown }>(
          "SELECT data FROM resume_analysis WHERE user_id = $1 AND id = $2",
          [userId, id],
        )
      ).rows[0];
      if (!row) throw new ProjectError(404, "Report not found");
      return savedResumeSchema.parse(row.data);
    },
    async delete(userId: string, id: string) {
      const result = await pool.query(
        "DELETE FROM resume_analysis WHERE user_id = $1 AND id = $2",
        [userId, id],
      );
      if (!result.rowCount) throw new ProjectError(404, "Report not found");
    },
  };
}
