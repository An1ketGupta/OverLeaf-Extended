import {
  errorSchema,
  healthSchema,
  readinessSchema,
  sessionSchema,
} from "@overleaf-pro/contracts";

export async function getStatus(signal: AbortSignal) {
  const [health, readiness] = await Promise.all([
    fetch("/api/health", {
      signal,
      credentials: "same-origin",
      cache: "no-store",
    }),
    fetch("/api/ready", {
      signal,
      credentials: "same-origin",
      cache: "no-store",
    }),
  ]);
  if (!health.ok) throw new Error("API is unavailable");
  const parsedHealth = healthSchema.parse(await health.json());
  if (![200, 503].includes(readiness.status))
    throw new Error("Database status is unavailable");
  return {
    health: parsedHealth,
    readiness: readinessSchema.parse(await readiness.json()),
  };
}
export async function getSession() {
  const response = await fetch("/api/session", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) return null;
  if (!response.ok)
    throw new Error(
      "Authentication needs a running API and configured database.",
    );
  return sessionSchema.parse(await response.json());
}
export async function authAction(
  action:
    | "sign-in/email"
    | "sign-up/email"
    | "sign-out"
    | "request-password-reset"
    | "reset-password"
    | "send-verification-email",
  body: Record<string, string>,
) {
  const response = await fetch(`/api/auth/${action}`, {
    method: "POST",
    credentials: "same-origin",
    signal: AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const json: unknown = await response.json().catch(() => null);
    const parsed = errorSchema.safeParse(json);
    const code =
      json && typeof json === "object" && "code" in json
        ? String(json.code)
        : "";
    const messages: Record<string, string> = {
      EMAIL_NOT_VERIFIED:
        "Verify your email first. Use Send verification email below.",
      INVALID_EMAIL_OR_PASSWORD: "Email or password is incorrect.",
      INVALID_TOKEN:
        "This link is invalid, expired or already used. Request a new link.",
      PASSWORD_TOO_SHORT: "Use a password of at least 12 characters.",
    };
    throw new Error(
      parsed.success
        ? parsed.data.error.message
        : response.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : (messages[code] ??
            "Account request failed. Check local email setup and try again."),
    );
  }
}
