import { limits } from "@overleaf-pro/contracts";
import { useEffect, useRef, useState } from "react";
import { projectApi } from "./api.js";
import type { ManagementTarget } from "./ManagementDialog.js";
import type { WorkspaceModel } from "./model.js";
import { mutateSavedProject } from "./mutations.js";

export function AssetControls({
  model,
  onManage,
}: {
  model: WorkspaceModel;
  onManage: (target: ManagementTarget) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [path, setPath] = useState("");
  const [file, setFile] = useState<File>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await operation();
      if (!alive.current || !model.isActive) return;
    } catch (error) {
      if (alive.current)
        setMessage(
          error instanceof Error ? error.message : "Project update failed",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <details className="asset-controls">
      <summary>Main file & images</summary>
      <label>
        Main LaTeX file{" "}
        <select
          aria-label="Main LaTeX file"
          value={model.project.mainFile}
          disabled={busy || model.paused || model.missing}
          onChange={(event) => {
            const path = event.target.value;
            void run(async () => {
              await mutateSavedProject(model, (project) =>
                projectApi.mainFile(project.id, project.revision, path),
              );
            });
          }}
        >
          {[...model.buffers.values()]
            .map((buffer) => buffer.base)
            .filter((f) => f.path.endsWith(".tex"))
            .map((f) => (
              <option key={f.id} value={f.path}>
                {f.path}
              </option>
            ))}
        </select>
      </label>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (!file || file.size > limits.assetBytes)
              throw new Error(
                "Choose a PNG, JPEG or PDF no larger than 2 MiB.",
              );
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = "";
            for (let offset = 0; offset < bytes.length; offset += 8192)
              binary += String.fromCharCode(
                ...bytes.subarray(offset, offset + 8192),
              );
            await mutateSavedProject(model, async (project) => {
              await projectApi.writeAsset(
                project.id,
                project.revision,
                path,
                btoa(binary),
                project.assets?.find((a) => a.path === path),
              );
              return projectApi.get(project.id);
            });
          });
        }}
      >
        <label>
          Image file
          <input
            aria-label="Upload project image"
            type="file"
            accept=".png,.jpg,.jpeg,.pdf"
            disabled={busy || model.paused || model.missing}
            onChange={(event) => {
              const f = event.target.files?.[0];
              setFile(f);
              if (f) setPath(f.name);
            }}
          />
        </label>
        <label>
          Image path
          <input
            aria-label="Image path"
            value={path}
            maxLength={240}
            required
            onChange={(event) => setPath(event.target.value)}
            disabled={busy || model.paused || model.missing}
          />
        </label>
        <button type="submit" disabled={busy || !file}>
          Save image
        </button>
      </form>
      <ul>
        {(model.project.assets ?? []).map((asset) => (
          <li key={asset.id}>
            <span>
              {asset.path} · {Math.ceil(asset.bytes / 1024)} KiB
            </span>
            <button
              type="button"
              disabled={busy || model.paused || model.missing}
              aria-label={`Rename image ${asset.path}`}
              onClick={() =>
                onManage({
                  action: "rename",
                  kind: "assets",
                  id: asset.id,
                  name: asset.path,
                })
              }
            >
              Rename
            </button>
            <button
              type="button"
              disabled={busy || model.paused || model.missing}
              aria-label={`Delete image ${asset.path}`}
              onClick={() =>
                onManage({
                  action: "delete",
                  kind: "assets",
                  id: asset.id,
                  name: asset.path,
                })
              }
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {message && <p role="alert">{message}</p>}
    </details>
  );
}
