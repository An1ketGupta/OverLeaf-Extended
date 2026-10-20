import { createHash, randomUUID } from "node:crypto";
import {
  limits,
  type SourceFile,
  textSnapshotSchema,
} from "@overleaf-pro/contracts";
import type pg from "pg";

export class ProjectError extends Error {
  constructor(
    public readonly status: 404 | 409 | 400,
    message: string,
  ) {
    super(message);
  }
}
type FileRow = {
  id: string;
  path: string;
  content: string;
  sha256: string;
  version: number;
};
const hash = (content: string) =>
  createHash("sha256").update(content).digest("hex");
const initialSource =
  "\\documentclass[11pt]{article}\n\\usepackage[margin=1in]{geometry}\n\n\\title{Untitled draft}\n\\author{}\n\\date{}\n\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\nEvery great document starts with a first draft.\n\n% Add another file and include it with \\input{sections/notes.tex}.\n\n\\end{document}\n";

export function projectRepository(pool: pg.Pool) {
  async function transaction<T>(
    operation: (client: pg.PoolClient) => Promise<T>,
  ) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async function owned(client: pg.PoolClient, userId: string, id: string) {
    const result = await client.query<{
      id: string;
      name: string;
      mainFile: string;
      revision: number;
      updatedAt: Date;
    }>(
      'SELECT id, name, main_file AS "mainFile", revision, updated_at AS "updatedAt" FROM project WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId],
    );
    const project = result.rows[0];
    if (!project) throw new ProjectError(404, "Project not found");
    return project;
  }
  async function files(client: pg.PoolClient, id: string) {
    return (
      await client.query<FileRow>(
        "SELECT id, path, content, sha256, version FROM project_file WHERE project_id = $1 ORDER BY path",
        [id],
      )
    ).rows;
  }
  async function readSnapshot(
    client: pg.PoolClient,
    projectId: string,
    snapshotId?: string,
    revision?: number,
  ) {
    const result = await client.query<{
      id: string;
      projectId: string;
      revision: number;
      mainFile: string;
      createdAt: Date;
      files: SourceFile[];
    }>(
      `SELECT id, project_id AS "projectId", revision, main_file AS "mainFile",
       created_at AS "createdAt", files FROM project_snapshot
       WHERE project_id = $1 AND ${snapshotId ? "id = $2" : "revision = $2"}`,
      [projectId, snapshotId ?? revision],
    );
    const row = result.rows[0];
    return row
      ? textSnapshotSchema.parse({
          ...row,
          createdAt: row.createdAt.toISOString(),
          assets: [],
        })
      : undefined;
  }
  return {
    async createSnapshot(userId: string, id: string, baseRevision: number) {
      return transaction(async (client) => {
        // Use the same lock order as account/project creation. The account lock
        // serializes retention checks across all of this owner's projects.
        await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
          userId,
        ]);
        const project = await owned(client, userId, id);
        if (project.revision !== baseRevision)
          throw new ProjectError(
            409,
            "Project changed. Refresh and review saved files before exporting.",
          );
        const existing = await readSnapshot(
          client,
          id,
          undefined,
          baseRevision,
        );
        if (existing) return existing;
        const parsed = textSnapshotSchema.safeParse({
          id: randomUUID(),
          projectId: id,
          revision: project.revision,
          mainFile: project.mainFile,
          createdAt: new Date().toISOString(),
          files: (await files(client, id)).map((file) => ({
            ...file,
            sha256: hash(file.content),
          })),
          assets: [],
        });
        if (!parsed.success)
          throw new ProjectError(
            400,
            "Project files cannot form a source snapshot. Check for file/directory path conflicts.",
          );
        const snapshot = parsed.data;
        const bytes = Buffer.byteLength(JSON.stringify(snapshot));
        const usage = await client.query<{ count: number; bytes: string }>(
          `SELECT count(*) FILTER (WHERE s.project_id = $2)::int AS count,
           COALESCE(sum(s.bytes), 0)::text AS bytes FROM project_snapshot s
           JOIN project p ON p.id = s.project_id WHERE p.user_id = $1`,
          [userId, id],
        );
        if (
          (usage.rows[0]?.count ?? 0) >= limits.snapshotsPerProject ||
          Number(usage.rows[0]?.bytes ?? 0) + bytes >
            limits.accountSnapshotBytes
        )
          throw new ProjectError(
            400,
            "Snapshot storage limit reached. Download individual drafts to keep your work.",
          );
        await client.query(
          "INSERT INTO project_snapshot (id, project_id, revision, main_file, created_at, files, bytes) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)",
          [
            snapshot.id,
            id,
            snapshot.revision,
            snapshot.mainFile,
            snapshot.createdAt,
            JSON.stringify(snapshot.files),
            bytes,
          ],
        );
        return snapshot;
      });
    },
    async getSnapshot(userId: string, id: string, snapshotId: string) {
      return transaction(async (client) => {
        await owned(client, userId, id);
        const snapshot = await readSnapshot(client, id, snapshotId);
        if (!snapshot) throw new ProjectError(404, "Snapshot not found");
        return snapshot;
      });
    },
    async list(userId: string) {
      const result = await pool.query<{
        id: string;
        name: string;
        updatedAt: Date;
      }>(
        'SELECT id, name, updated_at AS "updatedAt" FROM project WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100',
        [userId],
      );
      return result.rows.map((row) => ({
        ...row,
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
    async get(userId: string, id: string) {
      return transaction(async (client) => {
        const project = await owned(client, userId, id);
        return {
          ...project,
          updatedAt: project.updatedAt.toISOString(),
          files: await files(client, id),
        };
      });
    },
    async create(userId: string, name: string) {
      return transaction(async (client) => {
        // Serialize account project creation so the free-tier bound cannot be raced.
        await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
          userId,
        ]);
        const count = await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM project WHERE user_id = $1",
          [userId],
        );
        if ((count.rows[0]?.count ?? 0) >= 100)
          throw new ProjectError(400, "Project limit reached");
        const id = randomUUID();
        await client.query(
          "INSERT INTO project (id, user_id, name, main_file) VALUES ($1, $2, $3, $4)",
          [id, userId, name, "main.tex"],
        );
        for (const [path, content] of [
          ["main.tex", initialSource],
          [
            "sections/notes.tex",
            "% Working notes\n% Keep ideas here as your document takes shape.\n",
          ],
        ]) {
          await client.query(
            "INSERT INTO project_file (id, project_id, path, content, sha256) VALUES ($1, $2, $3, $4, $5)",
            [randomUUID(), id, path, content, hash(content ?? "")],
          );
        }
        return id;
      });
    },
    async addFile(userId: string, id: string, path: string, content: string) {
      return transaction(async (client) => {
        await owned(client, userId, id);
        const current = await files(client, id);
        if (current.some((file) => file.path === path))
          throw new ProjectError(409, "A file already uses this path");
        if (
          current.length >= 50 ||
          current.reduce(
            (sum, file) => sum + Buffer.byteLength(file.content),
            0,
          ) +
            Buffer.byteLength(content) >
            8 * 1024 * 1024
        )
          throw new ProjectError(400, "Project size limit reached");
        await client.query(
          "INSERT INTO project_file (id, project_id, path, content, sha256) VALUES ($1, $2, $3, $4, $5)",
          [randomUUID(), id, path, content, hash(content)],
        );
        await client.query(
          "UPDATE project SET revision = revision + 1, updated_at = now() WHERE id = $1",
          [id],
        );
      });
    },
    async save(
      userId: string,
      id: string,
      fileId: string,
      baseVersion: number,
      content: string,
    ) {
      return transaction(async (client) => {
        await owned(client, userId, id);
        const current = await files(client, id);
        const file = current.find((item) => item.id === fileId);
        if (!file) throw new ProjectError(404, "File not found");
        if (file.version !== baseVersion)
          throw new ProjectError(
            409,
            "File changed in another tab. Your draft has been kept.",
          );
        if (
          current.reduce(
            (sum, item) =>
              sum +
              Buffer.byteLength(item.id === fileId ? content : item.content),
            0,
          ) >
          8 * 1024 * 1024
        )
          throw new ProjectError(400, "Project size limit reached");
        const result = await client.query<FileRow>(
          "UPDATE project_file SET content = $1, sha256 = $2, version = version + 1 WHERE id = $3 AND project_id = $4 AND version = $5 RETURNING id, path, content, sha256, version",
          [content, hash(content), fileId, id, baseVersion],
        );
        if (!result.rows[0])
          throw new ProjectError(
            409,
            "File changed. Your draft has been kept.",
          );
        await client.query(
          "UPDATE project SET revision = revision + 1, updated_at = now() WHERE id = $1",
          [id],
        );
        return result.rows[0];
      });
    },
  };
}
