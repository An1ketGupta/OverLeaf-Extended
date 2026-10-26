import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router";
import { getStatus } from "./api.js";
import { Account } from "./features/account/Account.js";
import { Projects } from "./features/workspace/Projects.js";

const Workspace = lazy(() =>
  import("./features/workspace/Workspace.js").then((module) => ({
    default: module.Workspace,
  })),
);
const ResumeAnalysis = lazy(() =>
  import("./features/assistance/ResumeAnalysis.js").then((module) => ({
    default: module.ResumeAnalysis,
  })),
);

type Status = Awaited<ReturnType<typeof getStatus>>;

function Foundation() {
  const [status, setStatus] = useState<Status>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Manual refresh must restart and cancel the prior readiness request.
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    setStatus(undefined);
    void getStatus(controller.signal)
      .then(setStatus)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [attempt]);
  const database = status?.readiness.database;
  return (
    <>
      <div className="eyebrow">THE WORKSPACE / PART 00</div>
      <section className="intro">
        <div>
          <h1>
            A foundation for
            <br />
            <em>your next draft.</em>
          </h1>
          <p className="lede">
            A private place to write LaTeX, shape your resume, and review every
            AI-assisted change. We’re building the essentials first.
          </p>
        </div>
        <div className="edition">
          <span>OverLeaf-Pro</span>
          <strong>00</strong>
          <span>FOUNDATION EDITION</span>
        </div>
      </section>
      <section className="status-section" aria-labelledby="status-heading">
        <div className="section-top">
          <h2 id="status-heading">Workspace readiness</h2>
          <button
            className="text-button"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Check again <span aria-hidden="true">↻</span>
          </button>
        </div>
        <div className="status-grid" aria-live="polite">
          <article className="status-card">
            <span className="card-index">01 / CONNECTION</span>
            <div className="card-title">
              <h3>Application API</h3>
              <span className={`dot ${status ? "good" : ""}`} />
            </div>
            <strong>
              {failed ? "Unavailable" : status ? "Connected" : "Checking…"}
            </strong>
            <p>
              {failed
                ? "Start the API, then check again."
                : "The browser connects through the same-origin /api route."}
            </p>
          </article>
          <article className="status-card">
            <span className="card-index">02 / PERSISTENCE</span>
            <div className="card-title">
              <h3>Project database</h3>
              <span className={`dot ${database === "ready" ? "good" : ""}`} />
            </div>
            <strong>
              {failed
                ? "Unknown"
                : !status
                  ? "Checking…"
                  : database === "ready"
                    ? "Ready"
                    : database === "not-configured"
                      ? "Not configured"
                      : "Unavailable"}
            </strong>
            <p>
              {database === "ready"
                ? "The API can reach the migrated PostgreSQL schema."
                : "Connect a development database to enable the auth prototype."}
            </p>
          </article>
          <article className="status-card">
            <span className="card-index">03 / TYPESETTING</span>
            <div className="card-title">
              <h3>LaTeX compiler</h3>
              <span className="dot" />
            </div>
            <strong>Evaluation pending</strong>
            <p>
              Server and browser engines must pass compatibility and isolation
              checks.
            </p>
          </article>
        </div>
      </section>
      <section className="next-section">
        <div>
          <span className="eyebrow">BUILDING WITH INTENTION</span>
          <h2>
            Good drafts start
            <br />
            with solid foundations.
          </h2>
        </div>
        <div className="next-content">
          <p>
            Open your writing desk to edit and save private LaTeX projects.
            Analyze an uploaded resume PDF locally, or review AI edits in a
            project. Compilation remains in evaluation.
          </p>
          <Link className="primary-button" to="/auth-check">
            Open authentication check <span aria-hidden="true">↗</span>
          </Link>
          <Link className="primary-button" to="/projects">
            Open projects ↗
          </Link>
          <Link className="primary-button" to="/resume">
            Analyze a resume PDF ↗
          </Link>
          <span className="small-note">
            Use synthetic test accounts while setup is in progress.
          </span>
        </div>
      </section>
    </>
  );
}

function FoundationApp() {
  return (
    <div className="shell">
      <header>
        <Link className="brand" to="/" aria-label="OverLeaf-Pro home">
          <span className="brand-mark" aria-hidden="true">
            O<span>p</span>
          </span>
          OverLeaf<span className="brand-pro">Pro</span>
        </Link>
        <span className="stage-label">
          <span className="dot good" /> In development
        </span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Foundation />} />
          <Route
            path="/auth-check"
            element={<Account key="legacy-account" />}
          />
          <Route path="/account" element={<Account key="account" />} />
          <Route path="/forgot-password" element={<Account key="forgot" />} />
          <Route path="/reset-password" element={<Account key="reset" />} />
          <Route
            path="*"
            element={
              <section className="auth-panel">
                <h1>Page not found.</h1>
                <Link to="/">Return to workspace readiness</Link>
              </section>
            }
          />
        </Routes>
      </main>
      <footer>
        <span>Made for thoughtful work.</span>
        <span>Private by design. Built step by step.</span>
      </footer>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/projects" element={<Projects />} />
      <Route
        path="/resume"
        element={
          <Suspense fallback={<p role="status">Opening PDF analysis…</p>}>
            <ResumeAnalysis />
          </Suspense>
        }
      />
      <Route
        path="/projects/:projectId"
        element={
          <Suspense
            fallback={
              <p className="workspace-gate" role="status">
                Opening your workspace…
              </p>
            }
          >
            <Workspace />
          </Suspense>
        }
      />
      <Route path="*" element={<FoundationApp />} />
    </Routes>
  );
}
