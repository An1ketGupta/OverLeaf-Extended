import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { authAction, getSession } from "../../api.js";
import {
  announceLogout,
  announceSessionChange,
  clearMismatchedDrafts,
  onLogout,
  onSessionChange,
} from "../workspace/drafts.js";

export function Account() {
  const location = useLocation();
  const reset = location.pathname === "/reset-password";
  const forgot = location.pathname === "/forgot-password";
  const [token] = useState(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
  );
  const [message, setMessage] = useState(() =>
    new URLSearchParams(window.location.search).has("error")
      ? "This link is invalid or expired. Request a new link."
      : new URLSearchParams(window.location.search).has("verified")
        ? "Email verified. Sign in to open your projects."
        : "Checking session…",
  );
  const [session, setSession] =
    useState<Awaited<ReturnType<typeof getSession>>>();
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    // Keep recovery tokens in memory only, out of history and subsequent referrers.
    if (reset)
      window.history.replaceState(window.history.state, "", "/reset-password");
    let alive = true;
    const load = () => {
      const current = ++generation.current;
      void getSession()
        .then((value) => {
          if (!alive || current !== generation.current) return;
          setSession(value);
          if (value) clearMismatchedDrafts(value.user.id);
          setMessage((old) =>
            old === "Checking session…"
              ? value
                ? "Session restored."
                : "No active session."
              : old,
          );
        })
        .catch(() => {
          if (alive && current === generation.current)
            setMessage(
              "Account services are unavailable. Check the local API and database.",
            );
        });
    };
    load();
    const sessionChange = onSessionChange(load);
    const logout = onLogout(() => {
      generation.current++;
      setSession(null);
      setMessage("Signed out.");
    });
    return () => {
      alive = false;
      sessionChange();
      logout();
    };
  }, [reset]);
  const run = async (action: () => Promise<void>) => {
    generation.current++;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Account request failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      const password = String(data.get("password") ?? "");
      if (reset) {
        if (password !== data.get("confirmation"))
          throw new Error("Passwords do not match.");
        if (!token)
          throw new Error(
            "This link is missing its token. Request a new link.",
          );
        await authAction("reset-password", { token, newPassword: password });
        announceSessionChange();
        setSession(null);
        setMessage(
          "Password reset. All previous sessions were revoked. Sign in with your new password.",
        );
      } else if (forgot) {
        await authAction("request-password-reset", {
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        setMessage(
          "If this address has an account, a reset link will arrive in the local inbox. If nothing arrives, check the local email service and retry.",
        );
      } else if (signup) {
        await authAction("sign-up/email", {
          name: String(data.get("name")),
          email,
          password,
          callbackURL: `${window.location.origin}/account?verified=1`,
        });
        setMessage(
          "If this address is eligible, a verification link will arrive in the local inbox. Verify your email, then sign in. If nothing arrives, start the local email service and use Send verification email.",
        );
        setSignup(false);
      } else {
        await authAction("sign-in/email", { email, password });
        const value = await getSession();
        setSession(value);
        if (value) clearMismatchedDrafts(value.user.id);
        announceSessionChange();
        setMessage("Signed in.");
      }
      form.reset();
    });
  };
  return (
    <section className="auth-panel">
      <Link className="back-link" to="/">
        ← Workspace readiness
      </Link>
      <div className="eyebrow">YOUR PRIVATE WORKSPACE</div>
      <h1>
        {reset
          ? "Reset your password."
          : forgot
            ? "Recover your account."
            : signup
              ? "Create your account."
              : "Your account."}
      </h1>
      <p role="status" className="notice">
        {message}
      </p>
      {session && !reset && !forgot ? (
        <div>
          <p>
            Signed in as <strong>{session.user.email}</strong>
          </p>
          <p>
            <Link to="/projects">Open your projects ↗</Link>
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await authAction("sign-out", {});
                announceLogout();
                setSession(null);
                setMessage("Signed out.");
              })
            }
          >
            Sign out
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          {signup && (
            <label>
              Name
              <input name="name" autoComplete="name" required maxLength={100} />
            </label>
          )}
          {!reset && (
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={254}
              />
            </label>
          )}
          {!forgot && (
            <label>
              {reset ? "New password" : "Password"}
              <input
                name="password"
                type="password"
                autoComplete={
                  reset || signup ? "new-password" : "current-password"
                }
                required
                minLength={12}
                maxLength={128}
              />
            </label>
          )}
          {reset && (
            <label>
              Confirm password
              <input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
          )}
          <button
            className="primary-button"
            type="submit"
            disabled={busy || (reset && !token)}
          >
            {busy
              ? "Working…"
              : reset
                ? "Reset password"
                : forgot
                  ? "Send reset link"
                  : signup
                    ? "Create account"
                    : "Sign in"}
          </button>
          {!reset && !forgot && (
            <>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => setSignup(!signup)}
              >
                {signup ? "Use an existing account" : "Create an account"}
              </button>
              <button
                className="text-button"
                type="button"
                disabled={busy || !email}
                onClick={() =>
                  void run(async () => {
                    await authAction("send-verification-email", {
                      email,
                      callbackURL: `${window.location.origin}/account?verified=1`,
                    });
                    setMessage(
                      "If verification is needed, a link will arrive in the local inbox. If nothing arrives, check the local email service and retry.",
                    );
                  })
                }
              >
                Send verification email
              </button>
              <Link to="/forgot-password">Forgot password?</Link>
            </>
          )}
        </form>
      )}
      {(forgot || reset) && (
        <p>
          <Link to="/account">Back to sign in</Link> ·{" "}
          <Link to="/forgot-password">Request a new reset link</Link>
        </p>
      )}
      <p className="small-note">
        Local testing: verification and reset messages are captured in your
        local inbox. Links expire after one hour.
      </p>
    </section>
  );
}
