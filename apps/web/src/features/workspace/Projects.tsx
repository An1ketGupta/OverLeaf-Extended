import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { getSession } from "../../api.js";
import { projectApi } from "./api.js";
import "./workspace.css";

export function Projects() {
  const [projects, setProjects] =
    useState<Awaited<ReturnType<typeof projectApi.list>>>();
  const [message, setMessage] = useState("Loading your projects…");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry reloads projects.
  useEffect(() => {
    let active = true;
    void getSession()
      .then(async (session) => {
        if (!session) throw new Error("Sign in to open your private projects.");
        const result = await projectApi.list();
        if (active) {
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
  return (
    <div className="projects-page">
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
                  .create(name)
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
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !name.trim()}
              >
                {busy ? "Creating…" : "+ Create project"}
              </button>
            </form>
            <div className="project-list">
              {projects.length === 0 ? (
                <div className="project-empty">
                  <h2>Your desk is clear.</h2>
                  <p>Create a project above to start writing LaTeX.</p>
                </div>
              ) : (
                projects.map((project) => (
                  <Link
                    className="project-card"
                    key={project.id}
                    to={`/projects/${project.id}`}
                  >
                    <span className="project-card-icon" aria-hidden="true">
                      T<span>E</span>X
                    </span>
                    <h2>{project.name}</h2>
                    <span className="subtle">
                      Updated {new Date(project.updatedAt).toLocaleDateString()}
                    </span>
                    <span className="project-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </Link>
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
