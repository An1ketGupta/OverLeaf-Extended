import { errorSchema } from "@overleaf-pro/contracts";
export async function assistanceRequest(
  path: string,
  method = "GET",
  body?: unknown,
) {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  } catch {
    throw new Error(
      "Connection interrupted. Check recent requests before retrying; the server may have finished.",
    );
  }
  if (response.status === 204) return null;
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorSchema.safeParse(value);
    throw new Error(
      error.success
        ? error.data.error.message
        : "Request unavailable. Try again later.",
    );
  }
  return value;
}
