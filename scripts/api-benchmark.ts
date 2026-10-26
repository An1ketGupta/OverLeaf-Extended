import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createDatabase } from "@overleaf-pro/db";
import { buildApp } from "../apps/api/src/app.js";
import { readConfig } from "../apps/api/src/config.js";
import { clearTestMail, verifiedSignup } from "./test-account.js";
import { requireTestDatabase } from "./test-database.js";

// Bounded local HTTP timings against real PostgreSQL; synthetic fixtures only.
const database = createDatabase(requireTestDatabase());
const origin = "http://localhost:5173";
const email = `part7-api-timing-${randomUUID()}@example.test`;
const app = buildApp(
  readConfig({
    NODE_ENV: "test",
    APP_ORIGIN: origin,
    TRUSTED_ORIGINS: origin,
    AUTH_SECRET: randomUUID(),
    AUTH_ALLOW_SIGNUP: "true",
    MAIL_ENABLED: "true",
  }),
  { database },
);
const results = [];
try {
  await database.migrate();
  const signup = await verifiedSignup(app, origin, {
    name: "Synthetic API timing",
    email,
    password: "synthetic-api-timing-password-42",
  });
  const cookies = signup.headers["set-cookie"];
  const cookie = (Array.isArray(cookies) ? cookies : [cookies ?? ""])
    .map((c) => c.split(";")[0])
    .join("; ");
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  async function request(path: string, method = "GET", body?: unknown) {
    const start = performance.now();
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { origin, cookie, "content-type": "application/json" },
      signal: AbortSignal.timeout(12_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, "Synthetic timing requests must succeed");
    const result = await response.json();
    return { result, ms: Math.round((performance.now() - start) * 100) / 100 };
  }
  for (const templateId of ["resume-classic", "resume-compact", "report"]) {
    const { result: project } = await request("/projects", "POST", {
      name: `Timing ${templateId}`,
      templateId,
    });
    const captures: number[] = [],
      saves: number[] = [];
    let sourceBytes = 0;
    const file = project.files.find(
      (entry: { path: string }) => entry.path === "main.tex",
    );
    for (let i = 0; i < 5; i++) {
      const saved = await request(
        `/projects/${project.id}/files/${file.id}`,
        "PUT",
        {
          baseVersion: file.version + i,
          content: `${file.content}\n% Synthetic timing ${i}\n`,
        },
      );
      assert.equal(saved.result.version, file.version + i + 1);
      saves.push(saved.ms);
      const captured = await request(
        `/projects/${project.id}/compile-input`,
        "POST",
        { baseRevision: project.revision + i + 1 },
      );
      assert.equal(captured.result.kind, "ephemeral");
      assert.equal(captured.result.snapshot.revision, project.revision + i + 1);
      captures.push(captured.ms);
      sourceBytes = Buffer.byteLength(JSON.stringify(captured.result));
    }
    const summary = (values: number[]) => ({
      samplesMs: values,
      medianMs: [...values].sort((a, b) => a - b)[2],
      rangeMs: [Math.min(...values), Math.max(...values)],
    });
    results.push({
      templateId,
      serializedCaptureBytes: sourceBytes,
      save: summary(saves),
      capture: summary(captures),
    });
  }
  await mkdir(".cache/part-7", { recursive: true });
  await writeFile(
    ".cache/part-7/api-performance.json",
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        node: process.version,
        scope:
          "separate loopback HTTP API, real PostgreSQL; five synthetic saves and captures per catalog template",
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    "Local API timing passed: five saved-source writes and immutable input captures per catalog template; evidence in .cache/part-7/api-performance.json.",
  );
} finally {
  await database.pool.query('DELETE FROM "user" WHERE email=$1', [email]);
  await clearTestMail([email]);
  await app.close();
  await database.close();
}
