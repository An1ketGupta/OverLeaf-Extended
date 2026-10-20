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
  action: "sign-in/email" | "sign-up/email" | "sign-out",
  body: Record<string, string>,
) {
  const response = await fetch(`/api/auth/${action}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const parsed = errorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new Error(
      parsed.success
        ? parsed.data.error.message
        : "Authentication failed. Check credentials and whether prototype signup is enabled.",
    );
  }
}
