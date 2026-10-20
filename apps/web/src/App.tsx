import { type FormEvent, useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router";
import { authAction, getSession, getStatus } from "./api.js";

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
            This is the foundation prototype. Project editing, compilation, and
            resume analysis will arrive in the next roadmap stages.
          </p>
          <Link className="primary-button" to="/auth-check">
            Open authentication check <span aria-hidden="true">↗</span>
          </Link>
          <span className="small-note">
            Use synthetic test accounts while setup is in progress.
          </span>
        </div>
      </section>
    </>
  );
}

function AuthCheck() {
  const [session, setSession] =
    useState<Awaited<ReturnType<typeof getSession>>>();
  const [message, setMessage] = useState("Checking session…");
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState(false);
  useEffect(() => {
    void getSession()
      .then((value) => {
        setSession(value);
        setMessage(value ? "Session restored." : "No active session.");
      })
      .catch((error: Error) => setMessage(error.message));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    try {
      await authAction(signup ? "sign-up/email" : "sign-in/email", {
        name: String(fields.get("name") ?? ""),
        email: String(fields.get("email")),
        password: String(fields.get("password")),
      });
      setSession(await getSession());
      setMessage(
        "Signed in. Refresh this page to verify the session persists.",
      );
      form.reset();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Authentication failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await authAction("sign-out", {});
      setSession(await getSession());
      setMessage("Signed out.");
    } catch {
      setMessage("Sign-out failed. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-panel">
      <Link className="back-link" to="/">
        ← Workspace readiness
      </Link>
      <div className="eyebrow">PART 00 / AUTHENTICATION</div>
      <h1>
        Check your
        <br />
        <em>connection.</em>
      </h1>
      <p>
        Verify sign-in, refresh, and sign-out through the frontend proxy. Signup
        requires <code>AUTH_ALLOW_SIGNUP=true</code> in development.
      </p>
      <p role="status" className="notice">
        {message}
      </p>
      {session ? (
        <div>
          <p>
            Signed in as <strong>{session.user.email}</strong>
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          {signup && (
            <label>
              Name
              <input name="name" autoComplete="name" required maxLength={100} />
            </label>
          )}
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Working…" : signup ? "Create test account" : "Sign in"}
          </button>
          <button
            className="text-button"
            disabled={busy}
            type="button"
            onClick={() => setSignup(!signup)}
          >
            {signup ? "Use an existing account" : "Create a test account"}
          </button>
        </form>
      )}
    </section>
  );
}

export function App() {
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
          <Route path="/auth-check" element={<AuthCheck />} />
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
