import {
  limits,
  type Project,
  type SourceSnapshot,
} from "@overleaf-pro/contracts";
import { useEffect, useRef, useState } from "react";
import { projectApi } from "./api.js";
import { containDialogFocus } from "./dialog.js";
import { changedFiles } from "./diff.js";
import { captureSavedSource, savedProjectForHistory } from "./export.js";
import type { WorkspaceModel } from "./model.js";

export function History({
  model,
  onClose,
}: {
  model: WorkspaceModel;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof projectApi.snapshots>>
  >([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [comparison, setComparison] = useState<{
    snapshot: SourceSnapshot;
    current: Project;
  }>();
  const [path, setPath] = useState("");
  useEffect(() => {
    alive.current = true;
    const before = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    void projectApi
      .snapshots(model.project.id)
      .then((result) => {
        if (alive.current && model.isActive) setItems(result);
      })
      .catch((error: unknown) => {
        if (alive.current)
          setMessage(
            error instanceof Error ? error.message : "Could not load history.",
          );
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
    return () => {
      alive.current = false;
      element?.close();
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [model]);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await operation();
    } catch (error) {
      if (alive.current && model.isActive)
        setMessage(
          error instanceof Error ? error.message : "History request failed.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const changes = comparison
    ? changedFiles(comparison.snapshot.files, comparison.current.files)
    : [];
  return (
    <dialog
      onKeyDown={containDialogFocus}
      ref={dialog}
      className="history-dialog"
      aria-labelledby="history-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <div className="history-heading">
        <h2 id="history-title">Recoverable history</h2>
        <button type="button" disabled={busy} onClick={onClose}>
          Close history
        </button>
      </div>
      <p>
        Snapshots preserve saved text and image assets. Restore replaces the
        full source tree and first preserves the current revision. Up to{" "}
        {limits.snapshotsPerProject} revisions per project; no automatic
        deletion.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await captureSavedSource(model, {
              get: projectApi.get,
              createSnapshot: (id, revision) =>
                projectApi.createSnapshot(id, revision, name.trim()),
            });
            if (!alive.current || !model.isActive) return;
            setItems(await projectApi.snapshots(model.project.id));
            setName("");
            setMessage("Named snapshot saved.");
          });
        }}
      >
        <label>
          Snapshot name{" "}
          <input
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        </label>
        <button type="submit" disabled={busy || !name.trim()}>
          Save named snapshot
        </button>
      </form>
      {message && <p role="status">{message}</p>}
      {!busy && items.length === 0 && (
        <p>No snapshots yet. Give this saved revision a name to begin.</p>
      )}
      <ul className="history-list">
        {items.map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.name ?? "Source snapshot"}</strong> · r
              {item.revision} · {new Date(item.createdAt).toLocaleString()}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const current = await savedProjectForHistory(model);
                  const snapshot = await projectApi.snapshot(
                    model.project.id,
                    item.id,
                  );
                  if (!alive.current || !model.isActive) return;
                  setComparison({ snapshot, current });
                  setPath(
                    changedFiles(snapshot.files, current.files)[0]?.path ?? "",
                  );
                })
              }
            >
              Compare r{item.revision}
            </button>
          </li>
        ))}
      </ul>
      {comparison && (
        <section aria-label="Snapshot comparison">
          <h3>
            Snapshot r{comparison.snapshot.revision} → current r
            {comparison.current.revision}
          </h3>
          <p>
            Minus lines belong to the snapshot; plus lines belong to the current
            project. Restore returns to the minus side. Each file shows one
            changed block, which may include unchanged lines between edits.
          </p>
          {comparison.snapshot.mainFile !== comparison.current.mainFile && (
            <p>
              Main file: {comparison.snapshot.mainFile} →{" "}
              {comparison.current.mainFile}
            </p>
          )}
          <ul aria-label="Asset changes">
            {[
              ...new Set(
                [
                  ...comparison.snapshot.assets,
                  ...(comparison.current.assets ?? []),
                ].map((a) => a.path),
              ),
            ]
              .filter(
                (path) =>
                  comparison.snapshot.assets.find((a) => a.path === path)
                    ?.sha256 !==
                  comparison.current.assets?.find((a) => a.path === path)
                    ?.sha256,
              )
              .map((path) => (
                <li key={path}>
                  {path}:{" "}
                  {comparison.snapshot.assets.find((a) => a.path === path)
                    ?.bytes ?? 0}{" "}
                  bytes in snapshot →{" "}
                  {comparison.current.assets?.find((a) => a.path === path)
                    ?.bytes ?? 0}{" "}
                  bytes currently
                </li>
              ))}
          </ul>
          {changes.length ? (
            <>
              <label>
                Compare file{" "}
                <select
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                >
                  {changes.map((file) => (
                    <option value={file.path} key={file.path}>
                      {file.path} ({file.kind} since snapshot)
                    </option>
                  ))}
                </select>
              </label>
              <section aria-label="Source diff">
                <pre className="source-diff">
                  {changes.find((file) => file.path === path)?.diff}
                </pre>
              </section>
            </>
          ) : (
            <p>No source changes.</p>
          )}
          <p>
            Files added since the snapshot will be removed. Other open tabs will
            need to reload. The current saved revision remains in history.
          </p>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (model.hasUnsaved || !model.isActive)
                  throw new Error(
                    "Save or resolve all drafts and compare again before restoring.",
                  );
                await projectApi.restore(
                  model.project.id,
                  comparison.snapshot.id,
                  comparison.current.revision,
                );
                if (!alive.current || !model.isActive) return;
                window.location.reload();
              })
            }
          >
            Restore snapshot r{comparison.snapshot.revision}
          </button>
        </section>
      )}
    </dialog>
  );
}
