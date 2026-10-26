import {
  type LocalDraft,
  type Project,
  type TemplateId,
  templateCatalog,
} from "@overleaf-pro/contracts";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { getSession } from "../../api.js";
import { projectApi } from "./api.js";
import { onProjectChange } from "./changes.js";
import { downloadText } from "./download.js";
import {
  allDrafts,
  onLogout,
  onSessionChange,
  removeProjectDrafts,
} from "./drafts.js";
import { sourceArchive } from "./export.js";
import { ManagementDialog, type ManagementTarget } from "./ManagementDialog.js";
import { OrphanDrafts } from "./OrphanDrafts.js";
import "./workspace.css";

export function Projects() {
  const [projects, setProjects] =
    useState<Awaited<ReturnType<typeof projectApi.list>>>();
  const [message, setMessage] = useState("Loading your projects…");
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<"" | TemplateId>("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [userId, setUserId] = useState("");
  const [orphans, setOrphans] = useState<LocalDraft[]>([]);
  const [management, setManagement] = useState<{
    target: ManagementTarget;
    project: Project;
  }>();
  const [managementError, setManagementError] = useState("");
  const exportGeneration = useRef(0);
  useEffect(
    () => () => {
      exportGeneration.current++;
    },
    [],
  );
  const navigate = useNavigate();
  useEffect(() => {
    const refresh = () => {
      exportGeneration.current++;
      setProjects(undefined);
      setOrphans([]);
      setManagement(undefined);
      setAttempt((value) => value + 1);
    };
    const logout = onLogout(refresh),
      session = onSessionChange(refresh);
    const changes = onProjectChange(() => {
      if (!document.querySelector("dialog[open]"))
        setAttempt((value) => value + 1);
    });
    return () => {
      logout();
      session();
      changes();
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry reloads projects.
  useEffect(() => {
    let active = true;
    void getSession()
      .then(async (session) => {
        if (!session) throw new Error("Sign in to open your private projects.");
        const result = await projectApi.list();
        const drafts = allDrafts(session.user.id);
        const unavailable: LocalDraft[] = [];
        for (const id of new Set(drafts.map((draft) => draft.projectId))) {
          if (!result.some((project) => project.id === id)) {
            unavailable.push(
              ...drafts.filter((draft) => draft.projectId === id),
            );
            continue;
          }
          const project = await projectApi.get(id);
          unavailable.push(
            ...drafts.filter(
              (draft) =>
                draft.projectId === id &&
                !project.files.some((file) => file.id === draft.fileId),
            ),
          );
        }
        if (active) {
          setUserId(session.user.id);
          setOrphans(unavailable);
          setProjects(result);
          setMessage("");
        }
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error ? error.message : "Could not load projects.",
          );
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  async function openManagement(id: string, action: "rename" | "delete") {
    const generation = ++exportGeneration.current;
    setBusy(true);
    setManagementError("");
    try {
      const project = await projectApi.get(id);
      if (generation !== exportGeneration.current) return;
      setManagement({
        project,
        target: { action, kind: "project", id, name: project.name },
      });
    } catch {
      setMessage("Project could not be loaded. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  }
  async function submitManagement(name: string, discard: boolean) {
    if (!management) return;
    setBusy(true);
    setManagementError("");
    try {
      if (management.target.action === "rename")
        await projectApi.rename(
          management.project.id,
          management.project.revision,
          name,
        );
      else {
        if (
          !discard &&
          allDrafts(userId).some(
            (draft) => draft.projectId === management.project.id,
          )
        )
          throw new Error(
            "Open this project to recover and save its drafts, or download them and explicitly select discard before deleting.",
          );
        await projectApi.delete(
          management.project.id,
          management.project.revision,
        );
        removeProjectDrafts(userId, management.project.id);
      }
      setManagement(undefined);
      setAttempt((value) => value + 1);
    } catch (error) {
      setManagementError(
        error instanceof Error
          ? error.message
          : "Project update failed. Refresh and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="projects-page">
      {management && (
        <ManagementDialog
          target={management.target}
          unsaved={
            management.target.action === "delete" &&
            allDrafts(userId).some(
              (draft) => draft.projectId === management.project.id,
            )
          }
          busy={busy}
          error={managementError}
          onClose={() => {
            exportGeneration.current++;
            setManagement(undefined);
          }}
          onSubmit={(name, discard) => void submitManagement(name, discard)}
          downloadLabel={
            allDrafts(userId).some(
              (draft) => draft.projectId === management.project.id,
            )
              ? "Download drafts"
              : "Export saved project"
          }
          onDownload={() => {
            const drafts = allDrafts(userId).filter(
              (draft) => draft.projectId === management.project.id,
            );
            if (drafts.length) {
              for (const draft of drafts)
                downloadText(draft.content, `recovered-${draft.fileId}.tex`);
              return;
            }
            const generation = ++exportGeneration.current;
            setBusy(true);
            void (async () => {
              const snapshot = await projectApi.createSnapshot(
                management.project.id,
                management.project.revision,
              );
              const bytes = await sourceArchive(snapshot);
              const session = await getSession();
              if (
                generation !== exportGeneration.current ||
                session?.user.id !== userId
              )
                return;
              const url = URL.createObjectURL(
                new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
              );
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `project-${management.project.id}.zip`;
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            })()
              .catch((error: unknown) =>
                setManagementError(
                  error instanceof Error ? error.message : "Export failed.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        />
      )}
      <nav className="workspace-header">
        <Link className="brand" to="/">
          OverLeaf<span className="brand-pro">Pro</span>
        </Link>
        <Link to="/auth-check">Account</Link>
      </nav>
      <main className="projects-main">
        <span className="eyebrow">YOUR WRITING DESK</span>
        <h1>
          A place for
          <br />
          <em>your next idea.</em>
        </h1>
        <p>Pick up a draft, or begin with a blank page.</p>
        <OrphanDrafts
          drafts={orphans}
          onDiscard={(id) =>
            setOrphans((items) => items.filter((draft) => draft.fileId !== id))
          }
        />
        {message && (
          <div className="workspace-notice" role="status">
            {message}
            <div className="inline-actions">
              <Link to="/auth-check">Open account</Link>
              <button type="button" onClick={() => setAttempt(attempt + 1)}>
                Try again
              </button>
            </div>
          </div>
        )}
        {projects && (
          <>
            <form
              className="new-project"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void projectApi
                  .create(name, template || undefined)
                  .then((project) => navigate(`/projects/${project.id}`))
                  .catch((error: unknown) =>
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : "Could not create project.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                New project
                <input
                  autoComplete="off"
                  placeholder="A name for your draft"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Starting template
                <select
                  value={template}
                  onChange={(event) =>
                    setTemplate(event.target.value as typeof template)
                  }
                >
                  <option value="">Blank project</option>
                  {templateCatalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !name.trim()}
              >
                {busy ? "Creating…" : "+ Create project"}
              </button>
            </form>
            <p className="template-note">
              Original MIT-licensed templates use synthetic examples and
              standard LaTeX classes/fonts. Compiler compatibility is awaiting
              engine validation.
            </p>
            <div className="project-list">
              {projects.length === 0 ? (
                <div className="project-empty">
                  <h2>Your desk is clear.</h2>
                  <p>Create a project above to start writing LaTeX.</p>
                </div>
              ) : (
                projects.map((project) => (
                  <article className="project-card" key={project.id}>
                    <Link to={`/projects/${project.id}`}>
                      <span className="project-card-icon" aria-hidden="true">
                        T<span>E</span>X
                      </span>
                      <h2>{project.name}</h2>
                      <span className="subtle">
                        Updated{" "}
                        {new Date(project.updatedAt).toLocaleDateString()}
                      </span>
                      <span className="project-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </Link>
                    <div className="project-card-actions">
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Rename project ${project.name}`}
                        onClick={() =>
                          void openManagement(project.id, "rename")
                        }
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Delete project ${project.name}`}
                        onClick={() =>
                          void openManagement(project.id, "delete")
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </>
        )}
        <p className="projects-footnote">
          Source is saved to your account. Compilation will become available
          after engine validation.
        </p>
      </main>
    </div>
  );
}
