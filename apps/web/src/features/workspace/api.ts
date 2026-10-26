import {
  assetDeleteSchema,
  assetReplaceSchema,
  assetWriteSchema,
  compileInputSchema,
  createProjectSchema,
  createSnapshotSchema,
  createTextFileSchema,
  deleteEntrySchema,
  errorSchema,
  exportInputSchema,
  type ImportProject,
  importProjectSchema,
  mainFileSchema,
  projectListSchema,
  projectSchema,
  renameEntrySchema,
  renameProjectSchema,
  restoreSnapshotSchema,
  snapshotListSchema,
  sourceAssetSchema,
  sourceFileSchema,
  sourceSnapshotSchema,
  type TemplateId,
  updateFileSchema,
} from "@overleaf-pro/contracts";
import { announceProjectChange } from "./changes.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request(path: string, method = "GET", body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`/api/projects${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  } catch {
    throw new ApiError(
      0,
      "Connection lost. Your draft is kept in this tab. Retry when you are online.",
    );
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(json);
    throw new ApiError(
      response.status,
      response.status >= 500
        ? "Project service is temporarily unavailable. Your draft has been kept. Retry when it recovers."
        : parsed.success
          ? parsed.data.error.message
          : "Project request failed. Your draft has been kept.",
    );
  }
  if (method !== "GET") announceProjectChange(path.split("/")[1] ?? "");
  return json;
}
export const projectApi = {
  exportInput: async (id: string, baseRevision: number) =>
    exportInputSchema.parse(
      await request(
        `/${id}/export-input`,
        "POST",
        restoreSnapshotSchema.parse({ baseRevision }),
      ),
    ),
  importProject: async (input: ImportProject) =>
    projectSchema.parse(
      await request("/import", "POST", importProjectSchema.parse(input)),
    ),
  rename: async (id: string, baseRevision: number, name: string) =>
    projectSchema.parse(
      await request(
        `/${id}`,
        "PUT",
        renameProjectSchema.parse({ baseRevision, name }),
      ),
    ),
  delete: async (id: string, baseRevision: number) =>
    request(`/${id}`, "DELETE", restoreSnapshotSchema.parse({ baseRevision })),
  renameEntry: async (
    id: string,
    kind: "files" | "assets",
    entryId: string,
    baseRevision: number,
    baseVersion: number,
    path: string,
  ) =>
    projectSchema.parse(
      await request(
        `/${id}/${kind}/${entryId}/rename`,
        "POST",
        renameEntrySchema.parse({ baseRevision, baseVersion, path }),
      ),
    ),
  deleteFile: async (
    id: string,
    fileId: string,
    baseRevision: number,
    baseVersion: number,
  ) =>
    projectSchema.parse(
      await request(
        `/${id}/files/${fileId}`,
        "DELETE",
        deleteEntrySchema.parse({ baseRevision, baseVersion }),
      ),
    ),
  compileInput: async (id: string, baseRevision: number) =>
    compileInputSchema.parse(
      await request(
        `/${id}/compile-input`,
        "POST",
        restoreSnapshotSchema.parse({ baseRevision }),
      ),
    ),
  mainFile: async (id: string, baseRevision: number, path: string) =>
    projectSchema.parse(
      await request(
        `/${id}/main-file`,
        "POST",
        mainFileSchema.parse({ baseRevision, path }),
      ),
    ),
  writeAsset: async (
    id: string,
    baseRevision: number,
    path: string,
    dataBase64: string,
    existing?: { id: string; version: number },
  ) =>
    sourceAssetSchema.parse(
      await request(
        existing ? `/${id}/assets/${existing.id}` : `/${id}/assets`,
        existing ? "PUT" : "POST",
        existing
          ? assetReplaceSchema.parse({
              baseRevision,
              baseVersion: existing.version,
              dataBase64,
            })
          : assetWriteSchema.parse({ baseRevision, path, dataBase64 }),
      ),
    ),
  deleteAsset: async (
    id: string,
    assetId: string,
    baseRevision: number,
    baseVersion: number,
  ) =>
    request(
      `/${id}/assets/${assetId}`,
      "DELETE",
      assetDeleteSchema.parse({ baseRevision, baseVersion }),
    ),
  createSnapshot: async (id: string, baseRevision: number, name?: string) =>
    sourceSnapshotSchema.parse(
      await request(
        `/${id}/snapshots`,
        "POST",
        createSnapshotSchema.parse({
          baseRevision,
          ...(name === undefined ? {} : { name }),
        }),
      ),
    ),
  snapshots: async (id: string) =>
    snapshotListSchema.parse(await request(`/${id}/snapshots`)),
  snapshot: async (id: string, snapshotId: string) =>
    sourceSnapshotSchema.parse(await request(`/${id}/snapshots/${snapshotId}`)),
  restore: async (id: string, snapshotId: string, baseRevision: number) =>
    projectSchema.parse(
      await request(
        `/${id}/snapshots/${snapshotId}/restore`,
        "POST",
        restoreSnapshotSchema.parse({ baseRevision }),
      ),
    ),
  list: async () => projectListSchema.parse(await request("")),
  get: async (id: string) => projectSchema.parse(await request(`/${id}`)),
  create: async (name: string, templateId?: TemplateId) =>
    projectSchema.parse(
      await request(
        "",
        "POST",
        createProjectSchema.parse({
          name,
          ...(templateId === undefined ? {} : { templateId }),
        }),
      ),
    ),
  addFile: async (id: string, path: string, baseRevision: number) =>
    projectSchema.parse(
      await request(
        `/${id}/files`,
        "POST",
        createTextFileSchema.parse({ baseRevision, path, content: "" }),
      ),
    ),
  save: async (
    id: string,
    fileId: string,
    baseVersion: number,
    content: string,
  ) =>
    sourceFileSchema.parse(
      await request(
        `/${id}/files/${fileId}`,
        "PUT",
        updateFileSchema.parse({ baseVersion, content }),
      ),
    ),
};
