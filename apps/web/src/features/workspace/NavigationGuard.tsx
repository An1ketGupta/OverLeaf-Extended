import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { containDialogFocus } from "./dialog.js";
import { downloadText } from "./download.js";
import type { WorkspaceModel } from "./model.js";
export function NavigationGuard({ model }: { model: WorkspaceModel }) {
  const blocker = useBlocker(() => model.hasUnsaved || model.paused);
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const before = document.activeElement;
    if (blocker.state === "blocked") dialog.current?.showModal();
    else dialog.current?.close();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [blocker.state]);
  return (
    <dialog
      onKeyDown={containDialogFocus}
      className="management-dialog"
      ref={dialog}
      aria-label="Unsaved work"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && blocker.state === "blocked") blocker.reset();
      }}
    >
      <h2>Keep your unsaved work</h2>
      <p>
        Save your changes before leaving, or download drafts before explicitly
        discarding them.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="inline-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (blocker.state === "blocked") blocker.reset();
            setError("");
          }}
        >
          Stay
        </button>
        <button
          type="button"
          onClick={() => {
            for (const buffer of model.buffers.values())
              if (buffer.status !== "saved" || buffer.recovery)
                downloadText(
                  buffer.recovery?.content ?? buffer.content,
                  buffer.base.path,
                );
          }}
        >
          Download drafts
        </button>
        <button
          type="button"
          disabled={busy || model.paused}
          onClick={() => {
            setBusy(true);
            void (async () => {
              const saved = await Promise.all(
                [...model.buffers.keys()].map((id) => model.save(id)),
              );
              if (
                saved.every(Boolean) &&
                !model.hasUnsaved &&
                blocker.state === "blocked"
              )
                blocker.proceed();
              else
                setError(
                  "Saving failed. Your drafts are kept. Resolve them or download a copy first.",
                );
            })().finally(() => setBusy(false));
          }}
        >
          Save and leave
        </button>
        <button
          type="button"
          disabled={busy || model.paused}
          onClick={() => {
            model.discardAll();
            if (blocker.state === "blocked") blocker.proceed();
          }}
        >
          Discard drafts and leave
        </button>
      </div>
    </dialog>
  );
}
