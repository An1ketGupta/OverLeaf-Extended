import { createHash, randomUUID } from "node:crypto";
import {
  type AiOutput,
  type AiRequest,
  aiProposalSchema,
  type ImportProject,
  importProjectSchema,
  limits,
  type SourceAsset,
  type SourceFile,
  sourceSnapshotSchema,
} from "@overleaf-pro/contracts";
import type pg from "pg";
import { templateFiles } from "./templates.js";

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
const hash = (content: string | Uint8Array) =>
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
      assets: SourceAsset[];
    }>(
      `SELECT id, project_id AS "projectId", revision, main_file AS "mainFile",
       created_at AS "createdAt", files, assets FROM project_snapshot
       WHERE project_id = $1 AND ${snapshotId ? "id = $2" : "revision = $2"}`,
      [projectId, snapshotId ?? revision],
    );
    const row = result.rows[0];
    return row
      ? sourceSnapshotSchema.parse({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })
      : undefined;
  }
  async function capture(
    client: pg.PoolClient,
    project: Awaited<ReturnType<typeof owned>>,
    userId: string,
  ) {
    const id = project.id;
    const baseRevision = project.revision;
    const existing = await readSnapshot(client, id, undefined, baseRevision);
    if (existing) return existing;
    const parsed = sourceSnapshotSchema.safeParse({
      id: randomUUID(),
      projectId: id,
      revision: project.revision,
      mainFile: project.mainFile,
      createdAt: new Date().toISOString(),
      files: (await files(client, id)).map((file) => ({
        ...file,
        sha256: hash(file.content),
      })),
      assets: await assets(client, id),
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
      Number(usage.rows[0]?.bytes ?? 0) + bytes > limits.accountSnapshotBytes
    )
      throw new ProjectError(
        400,
        "Snapshot storage limit reached. Download individual drafts to keep your work.",
      );
    await client.query(
      "INSERT INTO project_snapshot (id, project_id, revision, main_file, created_at, files, bytes, assets) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)",
      [
        snapshot.id,
        id,
        snapshot.revision,
        snapshot.mainFile,
        snapshot.createdAt,
        JSON.stringify(snapshot.files),
        bytes,
        JSON.stringify(snapshot.assets),
      ],
    );
    return snapshot;
  }
  async function assets(
    client: pg.PoolClient,
    id: string,
  ): Promise<SourceAsset[]> {
    const rows = (
      await client.query<{
        id: string;
        path: string;
        version: number;
        sha256: string;
        mediaType: SourceAsset["mediaType"];
        data: Buffer;
      }>(
        'SELECT id,path,version,sha256,media_type AS "mediaType",data FROM project_asset WHERE project_id=$1 ORDER BY path',
        [id],
      )
    ).rows;
    return rows.map(({ data, ...row }) => ({
      ...row,
      bytes: data.length,
      sha256: hash(data),
      dataBase64: data.toString("base64"),
    }));
  }
  async function consistentInput(
    client: pg.PoolClient,
    project: Awaited<ReturnType<typeof owned>>,
  ) {
    return sourceSnapshotSchema.parse({
      id: randomUUID(),
      projectId: project.id,
      revision: project.revision,
      mainFile: project.mainFile,
      createdAt: new Date().toISOString(),
      files: (await files(client, project.id)).map((file) => ({
        ...file,
        sha256: hash(file.content),
      })),
      assets: await assets(client, project.id),
    });
  }
  const pathsConflict = (a: string, b: string) =>
    a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  function checkProject(nextFiles: FileRow[], nextAssets: SourceAsset[]) {
    const entries = [...nextFiles, ...nextAssets];
    if (
      entries.length > limits.projectFiles ||
      nextFiles.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0) +
        nextAssets.reduce((sum, a) => sum + a.bytes, 0) >
        limits.projectBytes
    )
      throw new ProjectError(400, "Project size limit reached");
    if (
      entries.some((a, i) =>
        entries.some((b, j) => i !== j && pathsConflict(a.path, b.path)),
      )
    )
      throw new ProjectError(409, "File and asset paths overlap");
  }
  const image = (path: string, dataBase64: string) => {
    const data = Buffer.from(dataBase64, "base64");
    const mediaType =
      data
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      /\.png$/i.test(path)
        ? "image/png"
        : data[0] === 255 &&
            data[1] === 216 &&
            data[2] === 255 &&
            /\.jpe?g$/i.test(path)
          ? "image/jpeg"
          : data.subarray(0, 5).toString() === "%PDF-" && /\.pdf$/i.test(path)
            ? "application/pdf"
            : undefined;
    if (
      !mediaType ||
      !data.length ||
      data.length > limits.assetBytes ||
      data.toString("base64") !== dataBase64
    )
      throw new ProjectError(
        400,
        "Upload a bounded PNG, JPEG or PDF with a matching extension",
      );
    return {
      data,
      mediaType: mediaType as SourceAsset["mediaType"],
      sha256: hash(data),
    };
  };
  async function readProject(
    client: pg.PoolClient,
    userId: string,
    id: string,
  ) {
    const project = await owned(client, userId, id);
    return {
      ...project,
      updatedAt: project.updatedAt.toISOString(),
      files: await files(client, id),
      assets: await assets(client, id),
    };
  }
  async function entryMutation(
    userId: string,
    id: string,
    entryId: string,
    baseRevision: number,
    baseVersion: number,
    kind: "files" | "assets",
    path?: string,
  ) {
    return transaction(async (client) => {
      await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
        userId,
      ]);
      const project = await owned(client, userId, id);
      const sources = await files(client, id);
      const images = await assets(client, id);
      const entries = kind === "files" ? sources : images;
      const entry = entries.find((item) => item.id === entryId);
      if (!entry) throw new ProjectError(404, "File not found");
      if (project.revision !== baseRevision || entry.version !== baseVersion)
        throw new ProjectError(
          409,
          "Project or file changed. Review the current version first.",
        );
      if (path === undefined) {
        if (entry.path === project.mainFile)
          throw new ProjectError(
            400,
            "Select another main .tex file before deleting this file.",
          );
        await capture(client, project, userId);
      } else {
        const others = [...sources, ...images].filter(
          (item) => item.id !== entryId,
        );
        if (
          others.some(
            (item) =>
              item.path === path ||
              item.path.startsWith(`${path}/`) ||
              path.startsWith(`${item.path}/`),
          )
        )
          throw new ProjectError(
            409,
            "This path conflicts with an existing file or directory.",
          );
        if (entry.path === project.mainFile && !path.endsWith(".tex"))
          throw new ProjectError(
            400,
            "The main file must keep a .tex extension.",
          );
        if (kind === "assets")
          image(
            path,
            images.find((item) => item.id === entryId)?.dataBase64 ?? "",
          );
      }
      // The table is selected exclusively from a server-owned enum, never input SQL.
      const table = kind === "files" ? "project_file" : "project_asset";
      if (path === undefined)
        await client.query(
          `DELETE FROM ${table} WHERE id=$1 AND project_id=$2`,
          [entryId, id],
        );
      else
        await client.query(
          `UPDATE ${table} SET path=$1, version=version+1 WHERE id=$2 AND project_id=$3`,
          [path, entryId, id],
        );
      await client.query(
        "UPDATE project SET main_file=$1,revision=revision+1,updated_at=now() WHERE id=$2",
        [entry.path === project.mainFile ? path : project.mainFile, id],
      );
      return readProject(client, userId, id);
    });
  }
  return {
    mutateEntry: entryMutation,
    async rename(
      userId: string,
      id: string,
      baseRevision: number,
      name: string,
    ) {
      return transaction(async (client) => {
        const project = await owned(client, userId, id);
        if (project.revision !== baseRevision)
          throw new ProjectError(
            409,
            "Project changed. Review it before renaming.",
          );
        await client.query(
          "UPDATE project SET name=$1,revision=revision+1,updated_at=now() WHERE id=$2",
          [name, id],
        );
        return readProject(client, userId, id);
      });
    },
    async delete(userId: string, id: string, baseRevision: number) {
      return transaction(async (client) => {
        await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
          userId,
        ]);
        const project = await owned(client, userId, id);
        if (project.revision !== baseRevision)
          throw new ProjectError(
            409,
            "Project changed. Review it before deleting.",
          );
        await client.query("DELETE FROM project WHERE id=$1 AND user_id=$2", [
          id,
          userId,
        ]);
      });
    },
    async compileInput(
      userId: string,
      id: string,
      baseRevision: number,
      purpose: "compile" | "export" = "compile",
    ) {
      return transaction(async (client) => {
        const project = await owned(client, userId, id);
        if (project.revision !== baseRevision)
          throw new ProjectError(
            409,
            "Project changed before capture. Reload and review saved files.",
          );
        const snapshot = await consistentInput(client, project);
        if (
          Buffer.byteLength(JSON.stringify(snapshot)) + 200 >
          (purpose === "export"
            ? limits.importRequestBytes
            : limits.compileInputBytes)
        )
          throw new ProjectError(
            400,
            "Serialized capture input exceeds the transport limit",
          );
        return { kind: "ephemeral" as const, captureId: snapshot.id, snapshot };
      });
    },
    async setMainFile(
      userId: string,
      id: string,
      baseRevision: number,
      path: string,
    ) {
      return transaction(async (client) => {
        const project = await owned(client, userId, id);
        if (project.revision !== baseRevision)
          throw new ProjectError(
            409,
            "Project changed. Reload before changing the main file.",
          );
        if (
          !path.endsWith(".tex") ||
          !(await files(client, id)).some((f) => f.path === path)
        )
          throw new ProjectError(400, "Choose an existing .tex source file");
        if (path !== project.mainFile)
          await client.query(
            "UPDATE project SET main_file=$1,revision=revision+1,updated_at=now() WHERE id=$2",
            [path, id],
          );
      });
    },
    async writeAsset(
      userId: string,
      id: string,
      baseRevision: number,
      path: string | undefined,
      dataBase64: string,
      assetId?: string,
      baseVersion?: number,
    ) {
      return transaction(async (client) => {
        await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
          userId,
        ]);
        const project = await owned(client, userId, id);
        if (project.revision !== baseRevision)
          throw new ProjectError(
            409,
            "Project changed. Reload before uploading an asset.",
          );
        const current = await assets(client, id);
        const old = assetId ? current.find((a) => a.id === assetId) : undefined;
        if (assetId && !old) throw new ProjectError(404, "Asset not found");
        if (old && old.version !== baseVersion)
          throw new ProjectError(409, "Asset version changed");
        const target = old?.path ?? path;
        if (!target) throw new ProjectError(400, "Asset path required");
        const decoded = image(target, dataBase64);
        const asset: SourceAsset = {
          id: old?.id ?? randomUUID(),
          path: target,
          version: (old?.version ?? 0) + 1,
          sha256: decoded.sha256,
          mediaType: decoded.mediaType,
          bytes: decoded.data.length,
          dataBase64,
        };
        checkProject(await files(client, id), [
          ...current.filter((a) => a.id !== old?.id),
          asset,
        ]);
        const total =
          (
            await client.query<{ bytes: string }>(
              "SELECT COALESCE(sum(octet_length(a.data)),0)::text AS bytes FROM project_asset a JOIN project p ON p.id=a.project_id WHERE p.user_id=$1",
              [userId],
            )
          ).rows[0]?.bytes ?? "0";
        if (
          Number(total) - (old?.bytes ?? 0) + asset.bytes >
          limits.accountAssetBytes
        )
          throw new ProjectError(400, "Account asset storage limit reached");
        if (old)
          await client.query(
            "UPDATE project_asset SET data=$1,sha256=$2,media_type=$3,version=version+1 WHERE id=$4",
            [decoded.data, asset.sha256, asset.mediaType, asset.id],
          );
        else
          await client.query(
            "INSERT INTO project_asset (id,project_id,path,data,sha256,media_type) VALUES ($1,$2,$3,$4,$5,$6)",
            [
              asset.id,
              id,
              asset.path,
              decoded.data,
              asset.sha256,
              asset.mediaType,
            ],
          );
        await client.query(
          "UPDATE project SET revision=revision+1,updated_at=now() WHERE id=$1",
          [id],
        );
        return asset;
      });
    },
    async deleteAsset(
      userId: string,
      id: string,
      assetId: string,
      baseRevision: number,
      baseVersion: number,
    ) {
      return transaction(async (client) => {
        await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
          userId,
        ]);
        const project = await owned(client, userId, id);
        const asset = (await assets(client, id)).find((a) => a.id === assetId);
        if (!asset) throw new ProjectError(404, "Asset not found");
        if (project.revision !== baseRevision || asset.version !== baseVersion)
          throw new ProjectError(409, "Project or asset changed");
        await capture(client, project, userId);
        await client.query(
          "DELETE FROM project_asset WHERE id=$1 AND project_id=$2",
          [assetId, id],
        );
        await client.query(
          "UPDATE project SET revision=revision+1,updated_at=now() WHERE id=$1",
          [id],
        );
      });
    },
    async beginProposal(userId: string, input: AiRequest, model: string) {
      return transaction(async (client) => {
        await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
          userId,
        ]);
        const fingerprint = hash(JSON.stringify(input));
        const prior = await client.query<{
          fingerprint: string;
          data: unknown;
          context: SourceFile[];
        }>(
          "SELECT fingerprint, data, context FROM ai_proposal WHERE id = $1 AND user_id = $2",
          [input.requestId, userId],
        );
        if (prior.rows[0]) {
          if (prior.rows[0].fingerprint !== fingerprint)
            throw new ProjectError(
              409,
              "Request ID already used for different input",
            );
          return {
            fresh: false,
            proposal: aiProposalSchema.parse(prior.rows[0].data),
            context: prior.rows[0].context,
          };
        }
        const project = await owned(client, userId, input.projectId);
        if (project.revision !== input.baseRevision)
          throw new ProjectError(
            409,
            "Project changed. Reload before requesting assistance.",
          );
        const context = (await files(client, project.id)).filter((f) =>
          input.fileIds.includes(f.id),
        );
        if (context.length !== input.fileIds.length)
          throw new ProjectError(
            400,
            "Context files do not belong to this project",
          );
        if (
          context.some((f) => Buffer.byteLength(f.content) > 24000) ||
          Buffer.byteLength(JSON.stringify(context)) > 48000
        )
          throw new ProjectError(
            400,
            "Select at most 48 KiB of context, with files up to 24 KiB",
          );
        if (input.selection) {
          const f = context.find((f) => f.id === input.selection?.fileId);
          if (
            !f ||
            input.selection.from >= input.selection.to ||
            input.selection.to > f.content.length
          )
            throw new ProjectError(
              400,
              "Selection is outside the selected saved file",
            );
        }
        const usage = await client.query<{ count: number; bytes: string }>(
          "SELECT count(*)::int AS count, COALESCE(sum(bytes),0)::text AS bytes FROM ai_proposal WHERE user_id = $1",
          [userId],
        );
        // Reserve bounded space for both input and the eventual result.
        if (
          (usage.rows[0]?.count ?? 0) >= 50 ||
          Number(usage.rows[0]?.bytes ?? 0) + 200000 > 8 * 1024 * 1024
        )
          throw new ProjectError(
            400,
            "Assistance history is full. Delete older requests first.",
          );
        const proposal = aiProposalSchema.parse({
          id: input.requestId,
          projectId: project.id,
          baseRevision: project.revision,
          status: "pending",
          createdAt: new Date().toISOString(),
          model,
          promptVersion: "latex-assistant-v1",
          result: null,
          failure: null,
          usage: null,
          backupSnapshotId: null,
          appliedRevision: null,
        });
        await client.query(
          "INSERT INTO ai_proposal (id, user_id, project_id, fingerprint, data, context, bytes) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,200000)",
          [
            proposal.id,
            userId,
            project.id,
            fingerprint,
            JSON.stringify(proposal),
            JSON.stringify(context),
          ],
        );
        return { fresh: true, proposal, context };
      });
    },
    async finishProposal(
      userId: string,
      id: string,
      result: AiOutput | null,
      usage: { inputTokens: number; outputTokens: number } | null,
      failure: string | null,
    ) {
      await pool.query(
        `UPDATE ai_proposal SET data = data || $3::jsonb WHERE id = $1 AND user_id = $2 AND data->>'status' = 'pending' AND (data->>'createdAt')::timestamptz > now() - interval '30 seconds'`,
        [
          id,
          userId,
          JSON.stringify({
            status: failure ? "failed" : result?.refused ? "refused" : "ready",
            result,
            usage,
            failure,
          }),
        ],
      );
    },
    async proposal(userId: string, id: string) {
      await pool.query(
        `UPDATE ai_proposal SET data = data || '{"status":"expired","failure":"Request interrupted or expired; no edits applied"}'::jsonb WHERE id = $1 AND user_id = $2 AND data->>'status' = 'pending' AND (data->>'createdAt')::timestamptz <= now() - interval '30 seconds'`,
        [id, userId],
      );
      const row = (
        await pool.query<{ data: unknown }>(
          "SELECT data FROM ai_proposal WHERE id = $1 AND user_id = $2",
          [id, userId],
        )
      ).rows[0];
      if (!row) throw new ProjectError(404, "Request not found");
      return aiProposalSchema.parse(row.data);
    },
    async listProposals(userId: string) {
      const result = await pool.query<{ data: unknown }>(
        "SELECT data FROM ai_proposal WHERE user_id = $1 ORDER BY data->>'createdAt' DESC LIMIT 50",
        [userId],
      );
      return result.rows.map((row) => aiProposalSchema.parse(row.data));
    },
    async deleteProposal(userId: string, id: string) {
      const result = await pool.query(
        "DELETE FROM ai_proposal WHERE id = $1 AND user_id = $2",
        [id, userId],
      );
      if (!result.rowCount) throw new ProjectError(404, "Request not found");
    },
    async rejectProposal(userId: string, id: string) {
      const result = await pool.query(
        `UPDATE ai_proposal SET data = data || '{"status":"rejected"}'::jsonb WHERE id = $1 AND user_id = $2 AND data->>'status' IN ('ready','pending')`,
        [id, userId],
      );
      if (!result.rowCount) {
        const exists = await pool.query(
          "SELECT 1 FROM ai_proposal WHERE id = $1 AND user_id = $2",
          [id, userId],
        );
        if (!exists.rowCount) throw new ProjectError(404, "Request not found");
        throw new ProjectError(409, "Request is no longer reviewable");
      }
    },
    async applyProposal(userId: string, id: string) {
      return transaction(async (client) => {
        await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
          userId,
        ]);
        const row = (
          await client.query<{ data: unknown; context: SourceFile[] }>(
            "SELECT data, context FROM ai_proposal WHERE id = $1 AND user_id = $2 FOR UPDATE",
            [id, userId],
          )
        ).rows[0];
        if (!row) throw new ProjectError(404, "Request not found");
        const proposal = aiProposalSchema.parse(row.data);
        if (proposal.status === "applied") return proposal;
        if (proposal.status !== "ready" || !proposal.result?.edits.length)
          throw new ProjectError(409, "No reviewable edits");
        const project = await owned(client, userId, proposal.projectId);
        const current = await files(client, project.id);
        if (
          project.revision !== proposal.baseRevision ||
          row.context.some(
            (base) =>
              !current.some(
                (f) => f.id === base.id && f.version === base.version,
              ),
          )
        )
          throw new ProjectError(
            409,
            "Project changed since this proposal. Request a new review.",
          );
        const edits = proposal.result.edits;
        if (
          edits.some((e) => !row.context.some((f) => f.id === e.fileId)) ||
          current.reduce(
            (s, f) =>
              s +
              Buffer.byteLength(
                edits.find((e) => e.fileId === f.id)?.content ?? f.content,
              ),
            0,
          ) +
            (await assets(client, project.id)).reduce(
              (sum, a) => sum + a.bytes,
              0,
            ) >
            limits.projectBytes
        )
          throw new ProjectError(400, "Invalid proposed files");
        const backup = await capture(client, project, userId);
        for (const edit of edits)
          await client.query(
            "UPDATE project_file SET content = $1, sha256 = $2, version = version + 1 WHERE id = $3 AND project_id = $4",
            [edit.content, hash(edit.content), edit.fileId, project.id],
          );
        await client.query(
          "UPDATE project SET revision = revision + 1, updated_at = now() WHERE id = $1",
          [project.id],
        );
        const applied = aiProposalSchema.parse({
          ...proposal,
          status: "applied",
          backupSnapshotId: backup.id,
          appliedRevision: project.revision + 1,
        });
        await client.query(
          "UPDATE ai_proposal SET data = $1::jsonb WHERE id = $2",
          [JSON.stringify(applied), id],
        );
        return applied;
      });
    },
    async createSnapshot(
      userId: string,
      id: string,
      baseRevision: number,
      name?: string,
    ) {
      return transaction(async (client) => {
        await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
          userId,
        ]);
        const project = await owned(client, userId, id);
        if (project.revision !== baseRevision)
          throw new ProjectError(
            409,
            "Project changed. Reload and review saved files before capturing history.",
          );
        const snapshot = await capture(client, project, userId);
        if (name !== undefined) {
          const label = await client.query<{ name: string }>(
            "SELECT name FROM snapshot_name WHERE snapshot_id = $1",
            [snapshot.id],
          );
          if (label.rows[0] && label.rows[0].name !== name)
            throw new ProjectError(
              409,
              "This revision already has a name. Edit the project before naming another revision.",
            );
          await client.query(
            "INSERT INTO snapshot_name (snapshot_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [snapshot.id, name],
          );
        }
        return snapshot;
      });
    },
    async listSnapshots(userId: string, id: string) {
      return transaction(async (client) => {
        await owned(client, userId, id);
        const result = await client.query<{
          id: string;
          revision: number;
          createdAt: Date;
          name: string | null;
        }>(
          `SELECT s.id, s.revision, s.created_at AS "createdAt", n.name FROM project_snapshot s
           LEFT JOIN snapshot_name n ON n.snapshot_id = s.id WHERE s.project_id = $1 ORDER BY s.revision DESC`,
          [id],
        );
        return result.rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        }));
      });
    },
    async restoreSnapshot(
      userId: string,
      id: string,
      snapshotId: string,
      baseRevision: number,
    ) {
      return transaction(async (client) => {
        await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
          userId,
        ]);
        const project = await owned(client, userId, id);
        if (project.revision !== baseRevision)
          throw new ProjectError(
            409,
            "Project changed since comparison. Reload and compare again before restoring.",
          );
        const target = await readSnapshot(client, id, snapshotId);
        if (!target) throw new ProjectError(404, "Snapshot not found");
        // Retention failure aborts the entire operation; history is never pruned.
        await capture(client, project, userId);
        const current = await files(client, id);
        await client.query(
          "DELETE FROM project_file WHERE project_id = $1 AND NOT (path = ANY($2::text[]))",
          [id, target.files.map((file) => file.path)],
        );
        for (const file of target.files) {
          const live = current.find((item) => item.path === file.path);
          if (live)
            await client.query(
              "UPDATE project_file SET content = $1, sha256 = $2, version = version + 1 WHERE id = $3",
              [file.content, hash(file.content), live.id],
            );
          else
            await client.query(
              "INSERT INTO project_file (id, project_id, path, content, sha256) VALUES ($1, $2, $3, $4, $5)",
              [randomUUID(), id, file.path, file.content, hash(file.content)],
            );
        }
        const liveAssets = await assets(client, id);
        const accountLive =
          (
            await client.query<{ bytes: string }>(
              "SELECT COALESCE(sum(octet_length(a.data)),0)::text AS bytes FROM project_asset a JOIN project p ON p.id=a.project_id WHERE p.user_id=$1",
              [userId],
            )
          ).rows[0]?.bytes ?? "0";
        if (
          Number(accountLive) -
            liveAssets.reduce((s, a) => s + a.bytes, 0) +
            target.assets.reduce((s, a) => s + a.bytes, 0) >
          limits.accountAssetBytes
        )
          throw new ProjectError(400, "Account asset storage limit reached");
        await client.query(
          "DELETE FROM project_asset WHERE project_id=$1 AND NOT(path=ANY($2::text[]))",
          [id, target.assets.map((a) => a.path)],
        );
        for (const asset of target.assets) {
          const data = Buffer.from(asset.dataBase64, "base64");
          const live = liveAssets.find((a) => a.path === asset.path);
          if (live)
            await client.query(
              "UPDATE project_asset SET data=$1,sha256=$2,media_type=$3,version=version+1 WHERE id=$4",
              [data, hash(data), asset.mediaType, live.id],
            );
          else
            await client.query(
              "INSERT INTO project_asset(id,project_id,path,data,sha256,media_type) VALUES($1,$2,$3,$4,$5,$6)",
              [randomUUID(), id, asset.path, data, hash(data), asset.mediaType],
            );
        }
        const updated = await client.query<{ updatedAt: Date }>(
          `UPDATE project SET main_file = $1, revision = revision + 1, updated_at = now() WHERE id = $2 RETURNING updated_at AS "updatedAt"`,
          [target.mainFile, id],
        );
        return {
          ...project,
          mainFile: target.mainFile,
          revision: project.revision + 1,
          updatedAt: updated.rows[0]?.updatedAt.toISOString(),
          files: await files(client, id),
          assets: await assets(client, id),
        };
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
        revision: number;
        updatedAt: Date;
      }>(
        'SELECT id, name, revision, updated_at AS "updatedAt" FROM project WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100',
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
          assets: await assets(client, id),
        };
      });
    },
    async create(userId: string, name: string, templateId?: string) {
      const source = templateId
        ? await templateFiles(templateId)
        : [
            { path: "main.tex", content: initialSource },
            {
              path: "sections/notes.tex",
              content:
                "% Working notes\n% Keep ideas here as your document takes shape.\n",
            },
          ];
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
        for (const { path, content } of source) {
          await client.query(
            "INSERT INTO project_file (id, project_id, path, content, sha256) VALUES ($1, $2, $3, $4, $5)",
            [randomUUID(), id, path, content, hash(content ?? "")],
          );
        }
        return id;
      });
    },
    async importProject(userId: string, input: ImportProject) {
      const tree = importProjectSchema.parse(input);
      const images = tree.assets.map((asset) => ({
        ...asset,
        ...image(asset.path, asset.dataBase64),
      }));
      return transaction(async (client) => {
        const owner = await client.query(
          'SELECT id FROM "user" WHERE id=$1 FOR UPDATE',
          [userId],
        );
        if (!owner.rowCount) throw new ProjectError(404, "Account not found");
        const usage = await client.query<{ count: number; bytes: string }>(
          "SELECT (SELECT count(*)::int FROM project WHERE user_id=$1) AS count, COALESCE(sum(octet_length(data)),0)::text AS bytes FROM project_asset WHERE project_id IN (SELECT id FROM project WHERE user_id=$1)",
          [userId],
        );
        if ((usage.rows[0]?.count ?? 0) >= 100)
          throw new ProjectError(400, "Project limit reached");
        if (
          Number(usage.rows[0]?.bytes ?? 0) +
            images.reduce((sum, asset) => sum + asset.data.length, 0) >
          limits.accountAssetBytes
        )
          throw new ProjectError(400, "Account asset storage limit reached");
        const id = randomUUID();
        await client.query(
          "INSERT INTO project (id,user_id,name,main_file) VALUES ($1,$2,$3,$4)",
          [id, userId, tree.name, tree.mainFile],
        );
        for (const file of tree.files)
          await client.query(
            "INSERT INTO project_file (id,project_id,path,content,sha256) VALUES ($1,$2,$3,$4,$5)",
            [randomUUID(), id, file.path, file.content, hash(file.content)],
          );
        for (const asset of images)
          await client.query(
            "INSERT INTO project_asset (id,project_id,path,media_type,sha256,data) VALUES ($1,$2,$3,$4,$5,$6)",
            [
              randomUUID(),
              id,
              asset.path,
              asset.mediaType,
              asset.sha256,
              asset.data,
            ],
          );
        return readProject(client, userId, id);
      });
    },
    async addFile(
      userId: string,
      id: string,
      path: string,
      content: string,
      baseRevision: number,
    ) {
      return transaction(async (client) => {
        const project = await owned(client, userId, id);
        if (project.revision !== baseRevision)
          throw new ProjectError(
            409,
            "Project changed. Review it before adding a file.",
          );
        const current = await files(client, id);
        const currentAssets = await assets(client, id);
        checkProject(
          [
            ...current,
            {
              id: randomUUID(),
              path,
              content,
              version: 1,
              sha256: hash(content),
            },
          ],
          currentAssets,
        );
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
          limits.projectBytes -
            (await assets(client, id)).reduce((sum, a) => sum + a.bytes, 0)
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
