import {
  createProjectSchema,
  createSnapshotSchema,
  createTextFileSchema,
  errorSchema,
  projectListSchema,
  projectSchema,
  sourceFileSchema,
  textSnapshotSchema,
  updateFileSchema,
} from "@overleaf-pro/contracts";

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
      parsed.success
        ? parsed.data.error.message
        : "Project request failed. Your draft has been kept.",
    );
  }
  return json;
}
export const projectApi = {
  createSnapshot: async (id: string, baseRevision: number) =>
    textSnapshotSchema.parse(
      await request(
        `/${id}/snapshots`,
        "POST",
        createSnapshotSchema.parse({ baseRevision }),
      ),
    ),
  list: async () => projectListSchema.parse(await request("")),
  get: async (id: string) => projectSchema.parse(await request(`/${id}`)),
  create: async (name: string) =>
    projectSchema.parse(
      await request("", "POST", createProjectSchema.parse({ name })),
    ),
  addFile: async (id: string, path: string) =>
    projectSchema.parse(
      await request(
        `/${id}/files`,
        "POST",
        createTextFileSchema.parse({ path, content: "" }),
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
