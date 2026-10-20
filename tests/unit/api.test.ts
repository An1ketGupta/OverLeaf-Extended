import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { readConfig } from "../../apps/api/src/config.js";

const apps: ReturnType<typeof buildApp>[] = [];
function app() {
  const server = buildApp(readConfig({ NODE_ENV: "test" }));
  apps.push(server);
  return server;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((server) => server.close()));
});
describe("foundation API", () => {
  it("keeps liveness available when the database fails without exposing credentials", async () => {
    const server = buildApp(
      readConfig({
        NODE_ENV: "test",
        DATABASE_URL:
          "postgresql://probe:private-secret@127.0.0.1:1/unreachable",
        AUTH_SECRET: "synthetic-integration-secret-with-32-characters",
      }),
    );
    apps.push(server);
    const ready = await server.inject("/api/ready");
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({
      status: "unavailable",
      database: "unavailable",
    });
    expect(ready.body).not.toContain("private-secret");
    expect((await server.inject("/api/health")).statusCode).toBe(200);
  });
  it("distinguishes liveness from unconfigured readiness", async () => {
    const server = app();
    expect((await server.inject("/api/health")).json()).toEqual({
      status: "ok",
      service: "overleaf-pro-api",
    });
    const ready = await server.inject("/api/ready");
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({
      status: "unavailable",
      database: "not-configured",
    });
    expect(ready.headers["cache-control"]).toBe("private, no-store");
    expect((await server.inject("/api/session")).statusCode).toBe(503);
  });
  it("rejects foreign and absent mutation origins before auth handling", async () => {
    const server = app();
    for (const headers of [{}, { origin: "https://evil.example" }]) {
      const response = await server.inject({
        method: "POST",
        url: "/api/auth/sign-out",
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(403);
    }
  });
  it("fails closed for unsafe production configuration", () => {
    expect(() => readConfig({ NODE_ENV: "production" })).toThrow();
    expect(() =>
      readConfig({ TRUSTED_ORIGINS: "https://*.vercel.app" }),
    ).toThrow();
    expect(() => readConfig({ APP_ORIGIN: "https://example.com/" })).toThrow();
  });
});
