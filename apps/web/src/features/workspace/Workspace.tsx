import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import type { LocalDraft, SourceFile } from "@overleaf-pro/contracts";
import {
  type CSSProperties,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link, useNavigate, useParams } from "react-router";
import { authAction, getSession } from "../../api.js";
import { Assistant } from "../assistance/Assistant.js";
import { analyzeCompiledPdf } from "../assistance/compiled-pdf.js";
import { AssetControls } from "./AssetControls.js";
import { ApiError, projectApi } from "./api.js";
import { CodeEditor } from "./CodeEditor.js";
import { onProjectChange } from "./changes.js";
import {
  announceLogout,
  onLogout,
  onSessionChange,
  readDrafts,
  removeDraft,
  writeDraft,
} from "./drafts.js";
import { captureSourceBackup, sourceArchive } from "./export.js";
import { FileTree } from "./FileTree.js";
import { History } from "./History.js";
import { ManagementDialog, type ManagementTarget } from "./ManagementDialog.js";
import { WorkspaceModel } from "./model.js";
import { mutateSavedProject } from "./mutations.js";
import { NavigationGuard } from "./NavigationGuard.js";
import { OrphanDrafts } from "./OrphanDrafts.js";
import { PdfPreview } from "./PdfPreview.js";
import { ResizeHandle } from "./ResizeHandle.js";
import { useCompilation } from "./useCompilation.js";
import "./workspace.css";

function downloadText(content: string, path: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = path.split("/").pop() ?? "draft.tex";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Workspace() {
  const { projectId } = useParams();
  const [model, setModel] = useState<WorkspaceModel>();
  const [message, setMessage] = useState("Opening your workspace…");
  const [attempt, setAttempt] = useState(0);
  const [orphans, setOrphans] = useState<LocalDraft[]>([]);
  useEffect(() => onLogout(() => setOrphans([])), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry restarts session/project loading.
  useEffect(() => {
    let active = true;
    let loaded: WorkspaceModel | undefined;
    setModel(undefined);
    setMessage("Opening your workspace…");
    void getSession()
      .then(async (session) => {
        if (!session) throw new Error("Sign in to open this private project.");
        if (!projectId) throw new Error("Project not found.");
        const drafts = readDrafts(session.user.id, projectId);
        if (active) setOrphans(drafts);
        const project = await projectApi.get(projectId);
        if (active) {
          setOrphans(
            drafts.filter(
              (draft) =>
                !project.files.some((file) => file.id === draft.fileId),
            ),
          );
          loaded = new WorkspaceModel(
            project,
            session.user.id,
            { save: projectApi.save, writeDraft, removeDraft },
            readDrafts(session.user.id, projectId),
          );
          setModel(loaded);
        }
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error ? error.message : "Could not open project.",
          );
      });
    return () => {
      active = false;
      loaded?.stop();
    };
  }, [projectId, attempt]);
  return model ? (
    <>
      <OrphanDrafts
        drafts={orphans}
        onDiscard={(id) =>
          setOrphans((items) => items.filter((draft) => draft.fileId !== id))
        }
      />
      <WorkspaceDesk key={`${projectId}-${attempt}`} model={model} />
    </>
  ) : (
    <div className="workspace-gate">
      <Link className="brand" to="/projects">
        OverLeaf<span className="brand-pro">Pro</span>
      </Link>
      <h1>Your writing desk.</h1>
      <p role="status">{message}</p>
      <OrphanDrafts
        drafts={orphans}
        onDiscard={(id) =>
          setOrphans((items) => items.filter((draft) => draft.fileId !== id))
        }
      />
      <div className="inline-actions">
        <Link to="/auth-check">Open account</Link>
        <Link to="/projects">Projects</Link>
        <button type="button" onClick={() => setAttempt(attempt + 1)}>
          Try again
        </button>
      </div>
    </div>
  );
}

function WorkspaceDesk({ model }: { model: WorkspaceModel }) {
  const revision = useSyncExternalStore(model.subscribe, model.snapshot);
  const mainId =
    model.project.files.find((file) => file.path === model.project.mainFile)
      ?.id ??
    model.project.files[0]?.id ??
    "";
  const [active, setActive] = useState(mainId);
  const [tabs, setTabs] = useState([mainId]);
  useEffect(() => {
    if (!model.buffers.has(mainId)) return;
    setTabs((items) => (items.includes(mainId) ? items : [...items, mainId]));
    setActive(mainId);
  }, [mainId, model]);
  const [filter, setFilter] = useState("");
  const [newPath, setNewPath] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [assistant, setAssistant] = useState<{
    fileId: string;
    selection: { from: number; to: number } | undefined;
  }>();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [management, setManagement] = useState<ManagementTarget>();
  const [managementError, setManagementError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [remote, setRemote] = useState<SourceFile>();
  const [treeWidth, setTreeWidth] = useState(220);
  const [pdfWidth, setPdfWidth] = useState(460);
  const [mobilePanel, setMobilePanel] = useState("editor");
  const [online, setOnline] = useState(navigator.onLine);
  const views = useRef(new Map<string, EditorView>());
  const fileSearch = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const current = model.buffers.get(active);
  const locked = signedOut || sessionExpired || model.authLost;
  const compilation = useCompilation(
    model,
    !locked && !model.paused && !model.missing,
  );
  const [manualPdf, setManualPdf] = useState<File>();
  const compileAction = useRef(compilation.compile);
  compileAction.current = compilation.compile;
  useEffect(() => {
    void compilation.output?.file;
    setManualPdf(undefined);
  }, [compilation.output?.file]);
  const exportAllowed = useRef(true);
  exportAllowed.current = !locked;
  useEffect(() => {
    exportAllowed.current = true;
    return () => {
      exportAllowed.current = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Model revision reschedules the autosave debounce on buffer changes.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!locked && !model.paused && !model.missing)
        for (const [id, file] of model.buffers)
          if (file.status === "dirty" && !file.recovery) void model.save(id);
    }, 700);
    return () => clearTimeout(timer);
  }, [model, revision, locked]);
  useEffect(
    () =>
      onLogout(() => {
        model.stop();
        setSignedOut(true);
      }),
    [model],
  );
  useEffect(() => {
    let mounted = true;
    let validation = 0;
    const unload = (event: BeforeUnloadEvent) => {
      if (model.hasUnsaved) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const connected = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine)
        for (const [id, file] of model.buffers)
          if (file.status === "error") void model.save(id);
    };
    const validateSession = () => {
      if (document.visibilityState !== "visible") return;
      const request = ++validation;
      void getSession()
        .then((session) => {
          if (!mounted || request !== validation || !model.isActive) return;
          if (!session || session.user.id !== model.userId) {
            model.suspend();
            setSessionExpired(true);
          }
        })
        .catch(() => {
          /* Save errors disclose outages. Never clear source on a network failure. */
        });
    };
    const validateProject = () => {
      if (model.paused || !model.isActive) return;
      const request = ++validation;
      const before = model.snapshot();
      void getSession()
        .then(async (session) => {
          if (!mounted || request !== validation || !model.isActive) return;
          if (!session || session.user.id !== model.userId) {
            model.suspend();
            setSessionExpired(true);
            return;
          }
          const project = await projectApi.get(model.project.id);
          if (
            !mounted ||
            request !== validation ||
            !model.isActive ||
            model.paused ||
            before !== model.snapshot()
          )
            return;
          if (
            project.name !== model.project.name ||
            project.mainFile !== model.project.mainFile ||
            project.files.length !== model.buffers.size ||
            project.files.some((file) => {
              const local = model.buffers.get(file.id)?.base;
              return (
                !local ||
                local.version !== file.version ||
                local.path !== file.path
              );
            }) ||
            JSON.stringify(project.assets ?? []) !==
              JSON.stringify(model.project.assets ?? [])
          )
            model.markRemote();
        })
        .catch((error: unknown) => {
          if (
            !mounted ||
            request !== validation ||
            !model.isActive ||
            before !== model.snapshot()
          )
            return;
          if (error instanceof ApiError && error.status === 404)
            model.markRemote(true);
        });
    };
    const stopSession = onSessionChange(validateSession);
    const stopChanges = onProjectChange((id) => {
      if (id === model.project.id) validateProject();
    });
    const visibleProject = () => {
      if (document.visibilityState === "visible") validateProject();
    };
    window.addEventListener("focus", validateProject);
    window.addEventListener("online", validateProject);
    document.addEventListener("visibilitychange", visibleProject);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("online", connected);
    window.addEventListener("offline", connected);
    document.addEventListener("visibilitychange", validateSession);
    return () => {
      mounted = false;
      validation++;
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", connected);
      document.removeEventListener("visibilitychange", validateSession);
      window.removeEventListener("focus", validateProject);
      window.removeEventListener("online", validateProject);
      document.removeEventListener("visibilitychange", visibleProject);
      stopSession();
      stopChanges();
    };
  }, [model]);
  useEffect(() => {
    if (!locked) {
      if (document.activeElement?.getAttribute("role") === "tab")
        document.getElementById(`tab-${active}`)?.focus();
      else views.current.get(active)?.focus();
    }
  }, [active, locked]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        locked ||
        management ||
        model.paused ||
        model.missing ||
        !(event.ctrlKey || event.metaKey)
      )
        return;
      if (event.key === "Enter") {
        event.preventDefault();
        void compileAction.current();
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void model.save(active);
      }
      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        setMobilePanel("files");
        requestAnimationFrame(() => fileSearch.current?.focus());
      }
      if (event.key.toLowerCase() === "f" && event.shiftKey) {
        event.preventDefault();
        const view = views.current.get(active);
        if (view) {
          view.focus();
          openSearchPanel(view);
        }
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [model, active, locked, management]);

  async function manage(name: string, discard: boolean) {
    if (!management) return;
    setBusy(true);
    setManagementError("");
    const target = management;
    try {
      const discards = new Set<string>();
      if (discard && target.action === "delete") {
        if (target.kind === "project")
          for (const id of model.buffers.keys()) discards.add(id);
        else discards.add(target.id);
      }
      compilation.cancel();
      const updated = await mutateSavedProject(
        model,
        async (project) => {
          if (target.kind === "project") {
            if (target.action === "rename")
              return projectApi.rename(project.id, project.revision, name);
            await projectApi.delete(project.id, project.revision);
            return null;
          }
          const entry = (
            target.kind === "files" ? project.files : (project.assets ?? [])
          ).find((item) => item.id === target.id);
          if (!entry)
            throw new Error(
              "This file is no longer available. Download your draft.",
            );
          if (target.action === "rename")
            return projectApi.renameEntry(
              project.id,
              target.kind,
              entry.id,
              project.revision,
              entry.version,
              name,
            );
          if (target.kind === "files")
            return projectApi.deleteFile(
              project.id,
              entry.id,
              project.revision,
              entry.version,
            );
          await projectApi.deleteAsset(
            project.id,
            entry.id,
            project.revision,
            entry.version,
          );
          return projectApi.get(project.id);
        },
        discards,
      );
      compilation.clear();
      setManagement(undefined);
      if (!updated) {
        if (target.kind === "project") navigate("/projects");
        return;
      }
      const available = new Set(updated.files.map((file) => file.id));
      setTabs((items) => {
        const next = items.filter((id) => available.has(id));
        return next.length
          ? next
          : [
              updated.files.find((file) => file.path === updated.mainFile)
                ?.id ??
                updated.files[0]?.id ??
                "",
            ];
      });
      if (!available.has(active))
        setActive(
          updated.files.find((file) => file.path === updated.mainFile)?.id ??
            updated.files[0]?.id ??
            "",
        );
      setRemote(undefined);
      setNotice(
        target.action === "delete"
          ? "File deleted. Its saved bytes can be recovered through History."
          : "Renamed. Update LaTeX references if needed.",
      );
    } catch (error) {
      setManagementError(
        error instanceof Error
          ? error.message
          : "Project update failed. Drafts were kept.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function switchFile(id: string) {
    if (id !== active && current && !(await model.save(active))) {
      setNotice(
        "This file needs attention before switching. Resolve the save error or conflict below.",
      );
      return;
    }
    setNotice("");
    setRemote(undefined);
    setTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
    setActive(id);
    setMobilePanel("editor");
  }
  async function closeTab(id: string) {
    if (!(await model.save(id))) {
      setNotice("Save or resolve this draft before closing its tab.");
      return;
    }
    if (tabs.length === 1) return;
    const next = tabs.filter((tab) => tab !== id);
    setTabs(next);
    if (active === id) setActive(next[0] ?? mainId);
  }
  async function leave() {
    const results = await Promise.all(
      [...model.buffers.keys()].map((id) => model.save(id)),
    );
    if (results.every(Boolean)) navigate("/projects");
    else
      setNotice(
        "Some changes are not saved. Retry or resolve them before leaving. You can also download the current draft.",
      );
  }
  async function signOut() {
    if (
      model.hasUnsaved &&
      !window.confirm(
        "Sign out and delete this tab’s recovery drafts? Download any unsaved work first.",
      )
    )
      return;
    setBusy(true);
    try {
      await authAction("sign-out", {});
      announceLogout();
    } catch {
      setNotice("Sign-out failed. Your work is still open. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function reviewConflict() {
    setBusy(true);
    try {
      const project = await projectApi.get(model.project.id);
      const latest = project.files.find((file) => file.id === active);
      if (!latest)
        throw new Error(
          "This file is no longer available. Download your draft to keep a copy.",
        );
      setRemote(latest);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not load saved version.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function exportProject() {
    setBusy(true);
    setNotice("Saving files and preparing project export…");
    try {
      const snapshot = await captureSourceBackup(model);
      const bytes = await sourceArchive(snapshot, "capture");
      if (!exportAllowed.current || !model.isActive) return;
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `project-${snapshot.projectId}-r${snapshot.revision}.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        `Exported saved revision ${snapshot.revision}. Source files are in the source folder; snapshot.json records their versions and hashes.`,
      );
    } catch (error) {
      if (exportAllowed.current) {
        if (error instanceof ApiError && error.status === 401) {
          model.suspend();
          setSessionExpired(true);
        }
        setNotice(
          error instanceof Error
            ? error.message
            : "Project export failed. Your draft has been kept.",
        );
      }
    } finally {
      if (exportAllowed.current) setBusy(false);
    }
  }
  if (locked)
    return (
      <div className="workspace-gate">
        <h1>{signedOut ? "Signed out." : "Sign in to continue."}</h1>
        <p>
          {signedOut
            ? "Recovery drafts have been deleted from this tab. Saved source remains in your account."
            : "Your editor is hidden. Recovery drafts stay in this tab for the same account; sign in and reopen the project to recover them."}
        </p>
        <Link to="/auth-check">Open account</Link>
        <Link to="/projects">Return to projects</Link>
      </div>
    );
  if (!current) return null;
  const files = [...model.buffers.values()]
    .map((file) => file.base)
    .sort((a, b) => a.path.localeCompare(b.path));
  const statusLabels = {
    saved: "All changes saved",
    dirty: "Unsaved changes",
    saving: "Saving…",
    error: "Save failed · draft kept",
    conflict: "Version conflict · draft kept",
  };
  return (
    <div
      className="workspace-app"
      style={
        {
          "--tree-width": `${treeWidth}px`,
          "--pdf-width": `${pdfWidth}px`,
        } as CSSProperties
      }
    >
      <NavigationGuard model={model} />
      {management && (
        <ManagementDialog
          key={`${management.action}-${management.id}`}
          target={management}
          unsaved={model.hasUnsaved}
          busy={busy}
          error={managementError}
          onClose={() => {
            setManagement(undefined);
            setManagementError("");
          }}
          onSubmit={(name, discard) => void manage(name, discard)}
          onDownload={() => {
            for (const file of model.buffers.values())
              downloadText(
                file.recovery?.content ?? file.content,
                file.base.path,
              );
          }}
        />
      )}
      {model.remoteChanged && (
        <div className="workspace-notice" role="alert">
          {model.missing
            ? "This project was deleted in another tab. Your draft is still available here for download. It cannot be saved to the deleted project."
            : "This project changed in another tab. Download any unsaved drafts, then reload and review the saved version."}
          <div className="inline-actions">
            <button
              type="button"
              onClick={() => {
                for (const file of model.buffers.values())
                  downloadText(
                    file.recovery?.content ?? file.content,
                    file.base.path,
                  );
              }}
            >
              Download drafts
            </button>
            <button
              type="button"
              disabled={model.paused}
              onClick={() => {
                if (
                  !model.hasUnsaved ||
                  window.confirm(
                    "Reload and keep your unsaved recovery drafts in this tab?",
                  )
                )
                  window.location.reload();
              }}
            >
              Reload and review
            </button>
          </div>
        </div>
      )}
      <nav className="workspace-header" aria-label="Workspace navigation">
        <div className="workspace-brand">
          <Link className="brand" to="/" aria-label="OverLeaf-Pro home">
            <span className="brand-mark" aria-hidden="true">
              O<span>p</span>
            </span>
            OverLeaf<span className="brand-pro">Pro</span>
          </Link>
          <span className="header-divider" />
          <button
            type="button"
            className="breadcrumb"
            onClick={() => void leave()}
          >
            Projects
          </button>
          <span className="subtle">/</span>
          <strong title={model.project.name}>{model.project.name}</strong>
          <button
            type="button"
            disabled={busy || model.missing}
            onClick={() =>
              setManagement({
                action: "rename",
                kind: "project",
                id: model.project.id,
                name: model.project.name,
              })
            }
          >
            Rename project
          </button>
          <button
            type="button"
            disabled={busy || model.missing}
            onClick={() =>
              setManagement({
                action: "delete",
                kind: "project",
                id: model.project.id,
                name: model.project.name,
              })
            }
          >
            Delete project
          </button>
        </div>
        <div className="workspace-account">
          <span className={`connection-pill ${online ? "" : "offline"}`}>
            <span className="dot good" />
            {online ? "Connected" : "Offline"}
          </span>
          <button type="button" onClick={() => void signOut()} disabled={busy}>
            Sign out
          </button>
        </div>
      </nav>
      <div className="workspace-toolbar">
        <div className="document-title">
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1>{model.project.name}</h1>
        </div>
        <div className="workspace-tools">
          <button
            type="button"
            onClick={() => {
              const view = views.current.get(active);
              if (view) {
                view.focus();
                openSearchPanel(view);
              }
            }}
          >
            Find <kbd>Ctrl F</kbd>
          </button>
          <button
            type="button"
            onClick={() => downloadText(current.content, current.base.path)}
          >
            Download file
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportProject()}
          >
            Export project (.zip)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setHistoryOpen(true)}
          >
            History
          </button>
          <button
            type="button"
            className="save-button"
            onClick={() => void model.save(active)}
          >
            Save <kbd>Ctrl S</kbd>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const range = views.current.get(active)?.state.selection.main;
              setAssistant({
                fileId: active,
                selection:
                  range && !range.empty
                    ? { from: range.from, to: range.to }
                    : undefined,
              });
            }}
          >
            AI assistant
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void Promise.all(
                [...model.buffers.keys()].map((id) => model.save(id)),
              )
                .then((saved) => {
                  if (
                    saved.every(Boolean) &&
                    !model.hasUnsaved &&
                    model.isActive
                  ) {
                    if (compilation.output && !manualPdf)
                      analyzeCompiledPdf({
                        file: compilation.output.file,
                        revision: compilation.output.event.revision,
                        projectId: model.project.id,
                        pdfSha256: compilation.output.event.pdfSha256,
                      });
                    navigate("/resume");
                  } else
                    setNotice(
                      "Save or resolve every draft before opening PDF analysis.",
                    );
                })
                .finally(() => setBusy(false));
            }}
          >
            Analyze resume PDF
          </button>
          <button
            type="button"
            className="compile-button"
            disabled={busy || compilation.compiling}
            title="Compile saved source (Ctrl/Cmd Enter)"
            onClick={() => void compilation.compile()}
          >
            ▷ Recompile
          </button>
          {compilation.compiling && (
            <button type="button" onClick={compilation.cancel}>
              Cancel compile
            </button>
          )}
          <label className="auto-compile">
            <input
              type="checkbox"
              checked={compilation.auto}
              onChange={(event) => compilation.setAuto(event.target.checked)}
            />
            Auto compile
          </label>
          {compilation.output && (
            <button
              type="button"
              onClick={() => {
                const output = compilation.output;
                if (!output) return;
                const url = URL.createObjectURL(output.file);
                const a = document.createElement("a");
                a.href = url;
                a.download = output.file.name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Download PDF
            </button>
          )}
        </div>
      </div>
      {historyOpen && (
        <History model={model} onClose={() => setHistoryOpen(false)} />
      )}
      {assistant && (
        <Assistant
          model={model}
          fileId={assistant.fileId}
          selection={assistant.selection}
          initialDiagnostics={compilation.messages
            .map(
              (d) =>
                `${d.path ?? ""}${d.line ? `:${d.line}` : ""} ${d.message}`,
            )
            .join("\n")
            .slice(0, 4000)}
          onClose={() => setAssistant(undefined)}
        />
      )}
      <div className="workspace-meta">
        <span>
          <span className={`save-dot ${current.status}`} />{" "}
          <span role="status" aria-live="polite">
            {statusLabels[current.status]}
          </span>
        </span>
        <span>LaTeX · main file: {model.project.mainFile}</span>
        <span role="status" aria-label="Compilation status">
          {
            (
              {
                idle: "Ready to compile",
                saving: "Saving source…",
                loading: "Loading compiler…",
                queued: "Compilation queued…",
                running: "Compiling…",
                succeeded: "Compilation succeeded",
                failed: "Compilation failed",
                cancelled: "Compilation cancelled",
                "timed-out": "Compilation timed out",
              } as Record<string, string>
            )[compilation.state]
          }
        </span>
      </div>
      <nav className="mobile-panels" aria-label="Workspace panels">
        {["files", "editor", "preview"].map((panel) => (
          <button
            type="button"
            key={panel}
            aria-pressed={mobilePanel === panel}
            onClick={() => setMobilePanel(panel)}
          >
            {panel === "files"
              ? "Files"
              : panel === "editor"
                ? "Source"
                : "PDF preview"}
          </button>
        ))}
      </nav>
      {notice && (
        <div className="workspace-notice" role="alert">
          {notice}
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      {!!compilation.messages.length && (
        <details
          className="compile-diagnostics"
          open={compilation.state === "failed"}
        >
          <summary>
            Compiler diagnostics ({compilation.messages.length})
          </summary>
          <ul>
            {compilation.messages.map((d) => (
              <li key={d.key}>
                <strong>{d.severity}: </strong>
                {d.path && (
                  <button
                    type="button"
                    onClick={() =>
                      void (async () => {
                        const file = [...model.buffers.values()]
                          .map((buffer) => buffer.base)
                          .find((f) => f.path === d.path);
                        if (!file || !(await model.save(active))) return;
                        await switchFile(file.id);
                        requestAnimationFrame(() => {
                          const view = views.current.get(file.id);
                          if (view) {
                            const line = view.state.doc.line(
                              Math.min(d.line ?? 1, view.state.doc.lines),
                            );
                            view.dispatch({
                              selection: { anchor: line.from },
                              scrollIntoView: true,
                            });
                            view.focus();
                          }
                        });
                      })()
                    }
                  >
                    {d.path}
                    {d.line ? `:${d.line}` : ""}
                  </button>
                )}
                <span>{d.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {model.storageFailed && (
        <div className="workspace-notice warning" role="alert">
          Browser draft recovery is unavailable. Keep this tab open until saving
          succeeds, or download your source.
        </div>
      )}
      <div className={`workspace-panels show-${mobilePanel}`}>
        <aside className="file-panel" aria-label="Project files">
          <div className="panel-heading">
            <span>Project files</span>
            <button
              type="button"
              aria-label="New file"
              onClick={() => setAdding(!adding)}
            >
              +
            </button>
          </div>
          <label className="file-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={fileSearch}
              placeholder="Find a file…"
              aria-label="Find a file"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          {adding && (
            <form
              className="new-file-form"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void (async () => {
                  const project = await mutateSavedProject(model, (saved) =>
                    projectApi.addFile(saved.id, newPath, saved.revision),
                  );
                  if (!project) return;
                  const created = project.files.find(
                    (file) => file.path === newPath,
                  );
                  setAdding(false);
                  setNewPath("");
                  if (created) await switchFile(created.id);
                })()
                  .catch((error: unknown) =>
                    setNotice(
                      error instanceof Error
                        ? error.message
                        : "Could not add file.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                Relative file path
                <input
                  aria-label="New file path"
                  value={newPath}
                  onChange={(event) => setNewPath(event.target.value)}
                  required
                  maxLength={240}
                  placeholder="sections/notes.tex"
                />
              </label>
              <button type="submit" disabled={busy}>
                Add file
              </button>
            </form>
          )}
          <nav className="file-list" aria-label="Files">
            <FileTree
              files={files.filter((file) =>
                file.path.toLowerCase().includes(filter.toLowerCase()),
              )}
              active={active}
              dirty={(id) => model.buffers.get(id)?.status !== "saved"}
              onOpen={(id) => void switchFile(id)}
              onManage={(target) => {
                setManagementError("");
                setManagement(target);
              }}
              disabled={busy || model.paused || model.missing}
            />
            {files.every(
              (file) => !file.path.toLowerCase().includes(filter.toLowerCase()),
            ) && <p className="empty-search">No matching files.</p>}
          </nav>
          <div className="file-panel-bottom">
            <AssetControls
              model={model}
              onManage={(target) => {
                setManagementError("");
                setManagement(target);
              }}
            />
            <span className="eyebrow">A LITTLE FOCUS GOES A LONG WAY</span>
            <p>One line, then the next.</p>
            <span>{files.length} files in this project</span>
          </div>
        </aside>
        <ResizeHandle
          label="Resize file panel"
          value={treeWidth}
          min={170}
          max={360}
          onChange={setTreeWidth}
        />
        <section className="source-panel" aria-label="Source workspace">
          <div
            className="source-tabs"
            role="tablist"
            aria-label="Open files"
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              const index = tabs.indexOf(active);
              const target =
                tabs[
                  (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                    tabs.length
                ];
              if (target) void switchFile(target);
            }}
          >
            {tabs.map((id) => {
              const file = model.buffers.get(id);
              return (
                file && (
                  <div
                    className={`source-tab ${active === id ? "active" : ""}`}
                    key={id}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-label={file.base.path}
                      title={file.base.path}
                      id={`tab-${id}`}
                      aria-controls={`source-${id}`}
                      aria-selected={active === id}
                      tabIndex={active === id ? 0 : -1}
                      onClick={() => void switchFile(id)}
                    >
                      {file.base.path.split("/").pop()}{" "}
                      {file.status !== "saved" ? "•" : ""}
                    </button>
                    {tabs.length > 1 && (
                      <button
                        type="button"
                        className="close-tab"
                        aria-label={`Close ${file.base.path}`}
                        onClick={() => void closeTab(id)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                )
              );
            })}
          </div>
          {current.recovery && (
            <div className="recovery-panel" role="alert">
              <strong>An unsaved draft is waiting.</strong>
              <p>Recovered from this browser tab. Review it before editing.</p>
              <button type="button" onClick={() => model.recover(active, true)}>
                Recover draft
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadText(
                    current.recovery?.content ?? "",
                    current.base.path,
                  )
                }
              >
                Download recovery copy
              </button>
              <button
                type="button"
                onClick={() => model.recover(active, false)}
              >
                Discard recovery draft
              </button>
            </div>
          )}
          {current.status === "error" && (
            <div className="recovery-panel" role="alert">
              <strong>{current.message}</strong>
              <button type="button" onClick={() => void model.save(active)}>
                Retry save
              </button>
              <button
                type="button"
                onClick={() => downloadText(current.content, current.base.path)}
              >
                Download draft
              </button>
            </div>
          )}
          {current.status === "conflict" && (
            <div className="recovery-panel" role="alert">
              <strong>Your draft and the saved file have diverged.</strong>
              <p>Your text has been kept. Compare versions before saving.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void reviewConflict()}
              >
                Compare saved version
              </button>
              <button
                type="button"
                onClick={() => downloadText(current.content, current.base.path)}
              >
                Download draft
              </button>
              {remote && (
                <>
                  <div className="conflict-comparison">
                    <label>
                      Saved version · v{remote.version}
                      <textarea readOnly value={remote.content} />
                    </label>
                    <label>
                      Your draft
                      <textarea readOnly value={current.content} />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      model.resolve(active, remote, true);
                      setRemote(undefined);
                    }}
                  >
                    Save my draft over v{remote.version}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      model.resolve(active, remote, false);
                      setRemote(undefined);
                    }}
                  >
                    Discard my draft and use saved version
                  </button>
                </>
              )}
            </div>
          )}
          <div className="editors">
            {tabs.map((id) => {
              const file = model.buffers.get(id);
              return (
                file && (
                  <div
                    className="editor-tab-panel"
                    role="tabpanel"
                    aria-labelledby={`tab-${id}`}
                    id={`source-${id}`}
                    hidden={id !== active || Boolean(file.recovery)}
                    key={id}
                  >
                    <CodeEditor
                      fileId={id}
                      path={file.base.path}
                      content={file.content}
                      readOnly={model.paused || model.missing || historyOpen}
                      onChange={(content) => model.edit(id, content)}
                      onSave={() => void model.save(id)}
                      onView={(view) => {
                        if (view) views.current.set(id, view);
                        else views.current.delete(id);
                      }}
                    />
                  </div>
                )
              );
            })}
          </div>
          <div className="editor-status">
            <span>
              {current.base.path}{" "}
              <span className="subtle">· v{current.base.version}</span>
            </span>
            <span>{current.content.split("\n").length} lines · UTF-8</span>
          </div>
        </section>
        <ResizeHandle
          label="Resize PDF panel"
          value={pdfWidth}
          min={280}
          max={700}
          direction={-1}
          onChange={setPdfWidth}
        />
        <PdfPreview
          importedLabel="This PDF is not compiled from this project."
          externalFile={manualPdf ?? compilation.output?.file}
          onFileChange={(file) => {
            setManualPdf(file);
            if (!file) compilation.clear();
          }}
          generated={
            !manualPdf && compilation.output
              ? {
                  revision: compilation.output.event.revision,
                  stale: compilation.stale,
                }
              : undefined
          }
        />
      </div>
      <div className="workspace-footer">
        <details>
          <summary>Draft privacy & shortcuts</summary>
          <p>
            Unsaved source is kept in this tab’s session storage for up to 24
            hours and recovered after refresh. It is accessible to scripts on
            this origin and anyone using this browser profile. Closing the tab
            ends recovery; browser session restore may retain it. Sign-out
            deletes recovery copies in open tabs. Download important unsaved
            work first.
          </p>
          <p>
            Ctrl/Cmd S: save · Ctrl/Cmd F: find/replace · Ctrl/Cmd P: find file
            · Ctrl/Cmd Space: completion · Escape then Tab: leave editor · Arrow
            keys: resize a focused divider or switch focused tabs.
          </p>
        </details>
        <span>
          Compilation stays in this browser.{" "}
          {compilation.output
            ? `PDF from revision ${compilation.output.event.revision}${compilation.stale ? " · Older output; recompile to update" : ""}`
            : "Ctrl/Cmd Enter to compile."}
        </span>
      </div>
    </div>
  );
}
