import {
  type LocalDraft,
  type Project,
  type SourceFile,
  updateFileSchema,
} from "@overleaf-pro/contracts";
import { ApiError } from "./api.js";

export type BufferState = {
  base: SourceFile;
  content: string;
  status: "saved" | "dirty" | "saving" | "error" | "conflict";
  message: string;
  recovery: LocalDraft | undefined;
};
export type WorkspacePersistence = {
  save: (
    projectId: string,
    fileId: string,
    version: number,
    content: string,
  ) => Promise<SourceFile>;
  writeDraft: (draft: LocalDraft) => boolean;
  removeDraft: (
    draft: Pick<LocalDraft, "userId" | "projectId" | "fileId">,
  ) => void;
};
export class WorkspaceModel {
  readonly buffers = new Map<string, BufferState>();
  private listeners = new Set<() => void>();
  private saves = new Map<string, Promise<boolean>>();
  private stopped = false;
  revision = 0;
  storageFailed = false;
  authLost = false;
  constructor(
    readonly project: Project,
    readonly userId: string,
    private persistence: WorkspacePersistence,
    drafts: LocalDraft[] = [],
  ) {
    for (const file of project.files) {
      const draft = drafts.find((draft) => draft.fileId === file.id);
      this.buffers.set(file.id, {
        base: file,
        content: file.content,
        status: "saved",
        message: "",
        recovery: draft && draft.content !== file.content ? draft : undefined,
      });
      if (draft?.content === file.content) this.persistence.removeDraft(draft);
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  private changed() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  private draft(file: BufferState) {
    if (this.stopped) return;
    if (
      !this.persistence.writeDraft({
        userId: this.userId,
        projectId: this.project.id,
        fileId: file.base.id,
        baseVersion: file.base.version,
        content: file.content,
        savedAt: Date.now(),
      })
    )
      this.storageFailed = true;
  }
  edit(id: string, content: string) {
    const file = this.buffers.get(id);
    if (!file || this.stopped || file.recovery || file.content === content)
      return;
    file.content = content;
    if (file.status !== "conflict")
      file.status = this.saves.has(id)
        ? "saving"
        : content === file.base.content
          ? "saved"
          : "dirty";
    if (file.status === "saved")
      this.persistence.removeDraft({
        userId: this.userId,
        projectId: this.project.id,
        fileId: id,
      });
    else this.draft(file);
    this.changed();
  }
  recover(id: string, restore: boolean) {
    const file = this.buffers.get(id);
    if (!file?.recovery || this.stopped) return;
    const draft = file.recovery;
    file.recovery = undefined;
    if (restore) {
      file.content = draft.content;
      file.status =
        draft.baseVersion === file.base.version ? "dirty" : "conflict";
      file.message =
        "The saved file changed while this draft was open. Review both versions.";
      this.draft(file);
    } else this.persistence.removeDraft(draft);
    this.changed();
  }
  resolve(id: string, remote: SourceFile, keepDraft: boolean) {
    const file = this.buffers.get(id);
    if (!file || this.stopped) return;
    file.base = remote;
    if (!keepDraft) file.content = remote.content;
    file.status = file.content === remote.content ? "saved" : "dirty";
    file.message = "";
    if (file.status === "saved")
      this.persistence.removeDraft({
        userId: this.userId,
        projectId: this.project.id,
        fileId: id,
      });
    else this.draft(file);
    this.changed();
  }
  save(id: string): Promise<boolean> {
    const pending = this.saves.get(id);
    if (pending) return pending;
    const operation = this.flush(id);
    this.saves.set(id, operation);
    void operation.finally(() => {
      this.saves.delete(id);
    });
    return operation;
  }
  private async flush(id: string) {
    const file = this.buffers.get(id);
    if (!file || this.stopped || file.recovery || file.status === "conflict")
      return false;
    if (file.status === "saved") return true;
    while (!this.stopped) {
      const content = file.content;
      const input = updateFileSchema.safeParse({
        baseVersion: file.base.version,
        content,
      });
      if (!input.success) {
        file.status = "error";
        file.message =
          "Use valid Unicode text without null bytes, no larger than 256 KiB. Download your draft before shortening it.";
        this.changed();
        return false;
      }
      file.status = "saving";
      this.changed();
      try {
        const saved = await this.persistence.save(
          this.project.id,
          id,
          file.base.version,
          content,
        );
        if (this.stopped) return false;
        file.base = saved;
        if (file.content === content) {
          file.status = "saved";
          file.message = "";
          this.persistence.removeDraft({
            userId: this.userId,
            projectId: this.project.id,
            fileId: id,
          });
          this.changed();
          return true;
        }
        this.draft(file); // Keep the newer text and advance its base version after an acknowledgement.
      } catch (error) {
        if (this.stopped) return false;
        file.status =
          error instanceof ApiError && error.status === 409
            ? "conflict"
            : "error";
        file.message =
          error instanceof Error
            ? error.message
            : "Save failed. Your draft is kept.";
        this.authLost = error instanceof ApiError && error.status === 401;
        this.draft(file);
        this.changed();
        return false;
      }
    }
    return false;
  }
  get hasUnsaved() {
    return [...this.buffers.values()].some(
      (file) => file.status !== "saved" || file.recovery,
    );
  }
  get isActive() {
    return !this.stopped && !this.authLost;
  }
  stop() {
    this.stopped = true;
    this.buffers.clear();
    this.changed();
  }
}
