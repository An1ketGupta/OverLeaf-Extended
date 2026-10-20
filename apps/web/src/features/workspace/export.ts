import {
  type Project,
  type SourceSnapshot,
  textSnapshotSchema,
} from "@overleaf-pro/contracts";
import { type Zippable, zipSync } from "fflate";
import { projectApi } from "./api.js";
import type { WorkspaceModel } from "./model.js";

type SnapshotApi = {
  get(id: string): Promise<Project>;
  createSnapshot(id: string, baseRevision: number): Promise<SourceSnapshot>;
};

export async function captureSavedSource(
  model: WorkspaceModel,
  api: SnapshotApi = projectApi,
) {
  if (!model.isActive) throw new Error("Reopen this project to export it.");
  const saved = await Promise.all(
    [...model.buffers.keys()].map((id) => model.save(id)),
  );
  if (!model.isActive || saved.some((result) => !result) || model.hasUnsaved)
    throw new Error(
      "Save or resolve every draft before exporting the project.",
    );
  const project = await api.get(model.project.id);
  // A fresh project revision alone is insufficient: another tab might have
  // changed a file this editor has never seen. Require the exact saved file set.
  if (
    !model.isActive ||
    model.hasUnsaved ||
    project.files.length !== model.buffers.size ||
    project.files.some((file) => {
      const local = model.buffers.get(file.id)?.base;
      return (
        !local ||
        local.version !== file.version ||
        local.path !== file.path ||
        local.content !== file.content
      );
    }) ||
    project.mainFile !== model.project.mainFile
  )
    throw new Error(
      "Saved files changed while this project was open. Reload and review them before exporting.",
    );
  const snapshot = textSnapshotSchema.parse(
    await api.createSnapshot(project.id, project.revision),
  );
  if (!model.isActive) throw new Error("Reopen this project to export it.");
  if (
    snapshot.projectId !== project.id ||
    snapshot.revision !== project.revision
  )
    throw new Error(
      "Snapshot does not match the requested project revision. Retry the export.",
    );
  return snapshot;
}

export async function sourceArchive(input: SourceSnapshot) {
  const snapshot = textSnapshotSchema.parse(input);
  const entries: Zippable = Object.create(null);
  for (const file of snapshot.files) {
    const bytes = new TextEncoder().encode(file.content);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== file.sha256)
      throw new Error("Source integrity check failed. Retry the export.");
    // Keep the manifest outside the source tree so project names cannot replace it.
    entries[`source/${file.path}`] = bytes;
  }
  entries["snapshot.json"] = new TextEncoder().encode(
    JSON.stringify(
      {
        format: "overleaf-pro-source-v1",
        snapshotId: snapshot.id,
        projectId: snapshot.projectId,
        revision: snapshot.revision,
        createdAt: snapshot.createdAt,
        mainFile: `source/${snapshot.mainFile}`,
        files: snapshot.files.map(({ content: _content, ...file }) => ({
          ...file,
          path: `source/${file.path}`,
        })),
      },
      null,
      2,
    ),
  );
  // Store bounded source bytes without expensive compression on the UI thread.
  return zipSync(entries, { level: 0 });
}
