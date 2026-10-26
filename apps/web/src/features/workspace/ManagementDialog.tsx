import { useEffect, useRef, useState } from "react";

export type ManagementTarget = {
  action: "rename" | "delete";
  kind: "project" | "files" | "assets";
  id: string;
  name: string;
};
export function ManagementDialog({
  target,
  unsaved = false,
  busy,
  error,
  onClose,
  onSubmit,
  onDownload,
  downloadLabel = "Download drafts",
}: {
  target: ManagementTarget;
  unsaved?: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (name: string, discard: boolean) => void;
  onDownload?: () => void;
  downloadLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(target.name);
  const [confirmation, setConfirmation] = useState("");
  const [discard, setDiscard] = useState(false);
  const title = `${target.action === "rename" ? "Rename" : "Delete"} ${target.kind === "project" ? "project" : target.kind === "assets" ? "image" : "file"}`;
  useEffect(() => {
    const before = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="management-dialog"
      aria-labelledby="management-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(name, discard);
        }}
      >
        <h2 id="management-title">{title}</h2>
        <p className="management-target">{target.name}</p>
        {target.action === "rename" ? (
          <>
            <label>
              {target.kind === "project" ? "Project name" : "New path"}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={target.kind === "project" ? 100 : 240}
                disabled={busy}
              />
            </label>
            {target.kind !== "project" && (
              <p>Update any LaTeX references to the old path after renaming.</p>
            )}
          </>
        ) : (
          <>
            <p>
              {target.kind === "project"
                ? "This permanently removes this project, its files, images, history and AI proposals. Saved resume reports remain in your account. Export a copy first. Other tabs may contain unsaved work that this tab cannot save."
                : "The saved tree will be preserved in History before deletion. Choose another main .tex file before deleting the current main file."}
            </p>
            {target.kind === "project" && (
              <label>
                Type the project name to confirm
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={busy}
                  autoComplete="off"
                />
              </label>
            )}
            {unsaved && (
              <label className="discard-choice">
                <input
                  type="checkbox"
                  checked={discard}
                  onChange={(event) => setDiscard(event.target.checked)}
                  disabled={busy}
                />
                Discard{" "}
                {target.kind === "project" ? "this project's" : "this file's"}{" "}
                unsaved draft when deletion succeeds
              </label>
            )}
          </>
        )}
        {unsaved && (
          <p>
            Unsaved work will be saved first unless you explicitly select
            discard. Failed saves stop this operation.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="inline-actions">
          {onDownload && (
            <button type="button" onClick={onDownload} disabled={busy}>
              {downloadLabel}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              busy ||
              (target.action === "delete" &&
                target.kind === "project" &&
                confirmation !== target.name)
            }
          >
            {busy
              ? "Working…"
              : target.action === "delete"
                ? "Confirm deletion"
                : "Save name"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
