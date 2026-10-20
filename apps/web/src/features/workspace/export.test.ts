import { createHash, randomUUID } from "node:crypto";
import type {
  Project,
  SourceFile,
  SourceSnapshot,
} from "@overleaf-pro/contracts";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { captureSavedSource, sourceArchive } from "./export.js";
import { WorkspaceModel } from "./model.js";

function fixture() {
  const files: SourceFile[] = [
    "main.tex",
    "sections/नोट्स.tex",
    "snapshot.json",
    "__proto__",
  ].map((path) => ({
    id: randomUUID(),
    path,
    content: `Original source: ${path}\n`,
    version: 1,
    sha256: createHash("sha256")
      .update(`Original source: ${path}\n`)
      .digest("hex"),
  }));
  const project: Project = {
    id: randomUUID(),
    name: "Test",
    mainFile: "main.tex",
    revision: 1,
    updatedAt: new Date().toISOString(),
    files,
  };
  const model = new WorkspaceModel(project, "test-user", {
    save: async (_id, fileId, version, content) => ({
      ...(files.find((file) => file.id === fileId) as SourceFile),
      content,
      version: version + 1,
      sha256: createHash("sha256").update(content).digest("hex"),
    }),
    writeDraft: () => true,
    removeDraft: () => {},
  });
  const snapshot: SourceSnapshot = {
    id: randomUUID(),
    projectId: project.id,
    revision: project.revision,
    mainFile: project.mainFile,
    createdAt: project.updatedAt,
    files,
    assets: [],
  };
  const api = {
    get: vi.fn(async () => project),
    createSnapshot: vi.fn(async () => snapshot),
  };
  return { model, project, snapshot, api };
}

describe("consistent source export", () => {
  it("preserves exact UTF-8 paths/content and puts provenance outside user source", async () => {
    const { snapshot } = fixture();
    const archive = unzipSync(await sourceArchive(snapshot));
    expect(Object.keys(archive).sort()).toEqual(
      [
        ...snapshot.files.map((file) => `source/${file.path}`),
        "snapshot.json",
      ].sort(),
    );
    for (const file of snapshot.files)
      expect(strFromU8(archive[`source/${file.path}`] as Uint8Array)).toBe(
        file.content,
      );
    const manifest = JSON.parse(
      strFromU8(archive["snapshot.json"] as Uint8Array),
    );
    expect(manifest.snapshotId).toBe(snapshot.id);
    expect(manifest.mainFile).toBe("source/main.tex");
    expect(manifest.files[0].sha256).toBe(snapshot.files[0]?.sha256);
    expect(manifest.files[0]).not.toHaveProperty("content");
  });
  it("rejects tampered source and unavailable asset bytes", async () => {
    const { snapshot } = fixture();
    if (snapshot.files[0]) snapshot.files[0].content = "tampered";
    await expect(sourceArchive(snapshot)).rejects.toThrow("integrity");
    await expect(
      sourceArchive({
        ...snapshot,
        assets: [{ path: "image.png", bytes: 1, sha256: "a".repeat(64) }],
      }),
    ).rejects.toThrow("Asset snapshots");
  });
  it("saves pending edits before requesting their exact revision", async () => {
    const { model, project, snapshot, api } = fixture();
    const id = project.files[0]?.id ?? "";
    model.edit(id, "Saved before export");
    api.get.mockImplementation(async () => ({
      ...project,
      revision: 2,
      files: [...model.buffers.values()].map((file) => file.base),
    }));
    api.createSnapshot.mockImplementation(async () => ({
      ...snapshot,
      revision: 2,
      files: [...model.buffers.values()].map((file) => file.base),
    }));
    await captureSavedSource(model, api);
    expect(model.hasUnsaved).toBe(false);
    expect(api.createSnapshot).toHaveBeenCalledWith(snapshot.projectId, 2);
  });
  it("refuses unresolved recovery and unseen remote changes", async () => {
    const { model, project, api } = fixture();
    const id = project.files[0]?.id ?? "";
    const file = model.buffers.get(id);
    if (file) file.status = "conflict";
    await expect(captureSavedSource(model, api)).rejects.toThrow(
      "resolve every draft",
    );
    expect(api.get).not.toHaveBeenCalled();
    if (file) file.status = "saved";
    api.get.mockImplementation(async () => ({
      ...project,
      files: project.files.map((file) => ({
        ...file,
        version: file.version + 1,
      })),
    }));
    await expect(captureSavedSource(model, api)).rejects.toThrow(
      "Reload and review",
    );
    expect(api.createSnapshot).not.toHaveBeenCalled();
  });
  it("drops in-flight capture after logout or project navigation", async () => {
    const { model, api } = fixture();
    api.createSnapshot.mockImplementation(async () => {
      model.stop();
      return fixture().snapshot;
    });
    await expect(captureSavedSource(model, api)).rejects.toThrow("Reopen");
  });
  it("rejects a response for a different revision", async () => {
    const { model, api, snapshot } = fixture();
    api.createSnapshot.mockResolvedValue({ ...snapshot, revision: 42 });
    await expect(captureSavedSource(model, api)).rejects.toThrow(
      "does not match",
    );
  });
});
