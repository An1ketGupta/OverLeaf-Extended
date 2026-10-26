import { randomUUID } from "node:crypto";
import type { LocalDraft, Project, SourceFile } from "@overleaf-pro/contracts";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../apps/web/src/features/workspace/api.js";
import {
  WorkspaceModel,
  type WorkspacePersistence,
} from "../../apps/web/src/features/workspace/model.js";

function fixture(save: WorkspacePersistence["save"]) {
  const file: SourceFile = {
    id: randomUUID(),
    path: "main.tex",
    version: 1,
    content: "original",
    sha256: "a".repeat(64),
  };
  const project: Project = {
    id: randomUUID(),
    name: "Test",
    revision: 1,
    mainFile: file.path,
    files: [file],
    updatedAt: new Date().toISOString(),
  };
  const drafts = new Map<string, LocalDraft>();
  const persistence: WorkspacePersistence = {
    save,
    writeDraft: (draft) => {
      drafts.set(draft.fileId, draft);
      return true;
    },
    removeDraft: (draft) => {
      drafts.delete(draft.fileId);
    },
  };
  const model = new WorkspaceModel(project, "user-a", persistence);
  return { file, project, drafts, model, persistence };
}
describe("workspace save ordering and recovery", () => {
  it("keeps typing during an in-flight save and writes it against the acknowledged version", async () => {
    let acknowledge: ((file: SourceFile) => void) | undefined;
    const requests: { version: number; content: string }[] = [];
    const { file, drafts, model } = fixture(
      async (_project, _id, version, content) => {
        requests.push({ version, content });
        if (requests.length === 1)
          return new Promise((resolve) => {
            acknowledge = resolve;
          });
        return { ...file, version: version + 1, content };
      },
    );
    model.edit(file.id, "first edit");
    const save = model.save(file.id);
    model.edit(file.id, "newer edit");
    expect(model.save(file.id)).toBe(save);
    acknowledge?.({ ...file, version: 2, content: "first edit" });
    expect(await save).toBe(true);
    expect(requests).toEqual([
      { version: 1, content: "first edit" },
      { version: 2, content: "newer edit" },
    ]);
    expect(model.buffers.get(file.id)?.content).toBe("newer edit");
    expect(drafts.size).toBe(0);
  });
  it("retains failed saves and retries without advancing the version", async () => {
    let fail = true;
    const { file, drafts, model } = fixture(
      async (_project, _id, version, content) => {
        if (fail) throw new ApiError(0, "offline");
        return { ...file, version: version + 1, content };
      },
    );
    model.edit(file.id, "offline edit");
    expect(await model.save(file.id)).toBe(false);
    expect(drafts.get(file.id)?.baseVersion).toBe(1);
    expect(model.buffers.get(file.id)?.content).toBe("offline edit");
    fail = false;
    expect(await model.save(file.id)).toBe(true);
    expect(model.buffers.get(file.id)?.base.version).toBe(2);
  });
  it("never retries a conflict until a user explicitly rebases it", async () => {
    let calls = 0;
    const { file, model } = fixture(async () => {
      calls++;
      throw new ApiError(409, "conflict");
    });
    model.edit(file.id, "my draft");
    expect(await model.save(file.id)).toBe(false);
    expect(await model.save(file.id)).toBe(false);
    expect(calls).toBe(1);
    model.resolve(file.id, { ...file, content: "other tab", version: 3 }, true);
    expect(model.buffers.get(file.id)?.content).toBe("my draft");
    expect(model.buffers.get(file.id)?.base.version).toBe(3);
    expect(model.buffers.get(file.id)?.status).toBe("dirty");
  });
  it("gates a recovered draft and detects its stale base version", () => {
    const { file, project, persistence } = fixture(async () => {
      throw new Error("must not save");
    });
    const model = new WorkspaceModel(project, "user-a", persistence, [
      {
        userId: "user-a",
        projectId: project.id,
        fileId: file.id,
        baseVersion: 2,
        content: "recovered",
        savedAt: Date.now(),
      },
    ]);
    model.edit(file.id, "unreviewed overwrite");
    expect(model.buffers.get(file.id)?.content).toBe("original");
    model.recover(file.id, true);
    expect(model.buffers.get(file.id)?.content).toBe("recovered");
    expect(model.buffers.get(file.id)?.status).toBe("conflict");
  });
  it("does not resurrect recovery data after logout while a save completes", async () => {
    let acknowledge: ((file: SourceFile) => void) | undefined;
    const { file, drafts, model } = fixture(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    model.edit(file.id, "private");
    const save = model.save(file.id);
    model.stop();
    drafts.clear();
    acknowledge?.({ ...file, version: 2, content: "private" });
    expect(await save).toBe(false);
    expect(drafts.size).toBe(0);
    expect(model.buffers.size).toBe(0);
  });
  it("keeps a draft when a late save completes after remote project deletion", async () => {
    let acknowledge: ((file: SourceFile) => void) | undefined;
    const { file, model, drafts } = fixture(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    model.edit(file.id, "last private draft");
    const pending = model.save(file.id);
    model.markRemote(true);
    acknowledge?.({ ...file, version: 2, content: "last private draft" });
    expect(await pending).toBe(false);
    expect(drafts.get(file.id)?.content).toBe("last private draft");
    expect(model.buffers.get(file.id)?.base.version).toBe(1);
    expect(await model.save(file.id)).toBe(false);
  });
  it("pauses editor changes during mutations and ignores late saves after session loss", async () => {
    let acknowledge: ((file: SourceFile) => void) | undefined;
    const { file, model, drafts } = fixture(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    model.edit(file.id, "private draft");
    const pending = model.save(file.id);
    model.pause();
    model.edit(file.id, "unaccepted typing");
    expect(model.buffers.get(file.id)?.content).toBe("private draft");
    model.suspend();
    acknowledge?.({ ...file, version: 2, content: "private draft" });
    expect(await pending).toBe(false);
    expect(drafts.get(file.id)?.content).toBe("private draft");
  });
});
