import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  compileInputSchema,
  limits,
  projectSchema,
  sourceAssetSchema,
  sourceSnapshotSchema,
} from "@overleaf-pro/contracts";
import { createDatabase } from "@overleaf-pro/db";
import { buildApp } from "../apps/api/src/app.js";
import { readConfig } from "../apps/api/src/config.js";
import { verifiedSignup } from "./test-account.js";
import { requireTestDatabase } from "./test-database.js";

const database = createDatabase(requireTestDatabase());
const origin = "http://localhost:5173";
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
const emails = [0, 1].map(() => `compiler-${randomUUID()}@example.test`);
async function signup(email: string) {
  const response = await verifiedSignup(app, origin, {
    email,
    name: "Compiler Fixture",
    password: "synthetic-compiler-password-42",
  });
  assert.equal(response.statusCode, 200);
  const cookies = response.headers["set-cookie"];
  return {
    origin,
    cookie: (Array.isArray(cookies) ? cookies : [cookies ?? ""])
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
try {
  await database.migrate();
  await database.migrate();
  const headers = await signup(emails[0] ?? "");
  const other = await signup(emails[1] ?? "");
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers,
    payload: { name: "Compiler assets" },
  });
  assert.equal(created.statusCode, 201);
  const initial = projectSchema.parse(created.json());
  const url = `/api/projects/${initial.id}`;
  const get = async () =>
    projectSchema.parse((await app.inject({ url, headers })).json());
  const capture = async (revision: number) =>
    app.inject({
      method: "POST",
      url: `${url}/compile-input`,
      headers,
      payload: { baseRevision: revision },
    });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${url}/compile-input`,
        headers: other,
        payload: { baseRevision: 1 },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${url}/compile-input`,
        headers: { origin },
        payload: { baseRevision: 1 },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${url}/compile-input`,
        headers: { ...headers, origin: "https://invalid.example" },
        payload: { baseRevision: 1 },
      })
    ).statusCode,
    403,
  );
  const first = compileInputSchema.parse((await capture(1)).json());
  const again = compileInputSchema.parse((await capture(1)).json());
  assert.notEqual(first.captureId, again.captureId);
  assert.equal(
    (await app.inject({ url: `${url}/snapshots`, headers })).json().length,
    0,
  );
  assert.equal(
    (await app.inject({ url: `${url}/snapshots/${first.captureId}`, headers }))
      .statusCode,
    404,
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=",
    "base64",
  );
  const upload = async (
    path: string,
    dataBase64: string,
    baseRevision: number,
  ) =>
    await app.inject({
      method: "POST",
      url: `${url}/assets`,
      headers,
      payload: { path, dataBase64, baseRevision },
    });
  for (const [path, bytes] of [
    ["../escape.png", png.toString("base64")],
    ["images/unsafe.svg", Buffer.from("<svg/>").toString("base64")],
    ["wrong.png", Buffer.from("not an image").toString("base64")],
  ])
    assert.equal((await upload(path ?? "", bytes ?? "", 1)).statusCode, 400);
  assert.equal(
    (await upload("main.tex", png.toString("base64"), 1)).statusCode,
    400,
  );
  const added = await upload("images/dot.png", png.toString("base64"), 1);
  assert.equal(added.statusCode, 201);
  const asset = sourceAssetSchema.parse(added.json());
  assert.equal(asset.sha256, createHash("sha256").update(png).digest("hex"));
  assert.equal((await capture(1)).statusCode, 409);
  let project = await get();
  assert.equal(project.revision, 2);
  assert.equal(project.assets?.length, 1);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${url}/files`,
        headers,
        payload: {
          baseRevision: (await app.inject({ url: `${url}`, headers })).json()
            .revision,
          path: "images/dot.png/child.tex",
          content: "x",
        },
      })
    ).statusCode,
    409,
  );
  const input = compileInputSchema.parse(
    (await capture(project.revision)).json(),
  );
  assert.equal(input.snapshot.assets[0]?.dataBase64, png.toString("base64"));
  const snapResponse = await app.inject({
    method: "POST",
    url: `${url}/snapshots`,
    headers,
    payload: { baseRevision: project.revision },
  });
  const snapshot = sourceSnapshotSchema.parse(snapResponse.json());
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `${url}/assets/${asset.id}`,
        headers: other,
        payload: {
          baseRevision: project.revision,
          baseVersion: 1,
          dataBase64: png.toString("base64"),
        },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `${url}/assets/${asset.id}`,
        headers,
        payload: {
          baseRevision: project.revision,
          baseVersion: 99,
          dataBase64: png.toString("base64"),
        },
      })
    ).statusCode,
    409,
  );
  const replacement = Buffer.concat([
    png,
    Buffer.from("SYNTHETIC-REPLACEMENT"),
  ]);
  const updated = await app.inject({
    method: "PUT",
    url: `${url}/assets/${asset.id}`,
    headers,
    payload: {
      baseRevision: project.revision,
      baseVersion: 1,
      dataBase64: replacement.toString("base64"),
    },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(sourceAssetSchema.parse(updated.json()).version, 2);
  const frozen = sourceSnapshotSchema.parse(
    (
      await app.inject({ url: `${url}/snapshots/${snapshot.id}`, headers })
    ).json(),
  );
  assert.equal(frozen.assets[0]?.dataBase64, png.toString("base64"));
  project = await get();
  const restored = await app.inject({
    method: "POST",
    url: `${url}/snapshots/${snapshot.id}/restore`,
    headers,
    payload: { baseRevision: project.revision },
  });
  assert.equal(restored.statusCode, 200);
  project = projectSchema.parse(restored.json());
  assert.equal(project.assets?.[0]?.dataBase64, png.toString("base64"));
  assert.equal(project.assets?.[0]?.version, 3);
  const beforeMain = project.revision;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${url}/main-file`,
        headers,
        payload: { baseRevision: beforeMain, path: "missing.tex" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${url}/main-file`,
        headers,
        payload: { baseRevision: beforeMain, path: "sections/notes.tex" },
      })
    ).statusCode,
    200,
  );
  project = await get();
  assert.equal(project.mainFile, "sections/notes.tex");
  const currentAsset = project.assets?.[0];
  assert.ok(currentAsset);
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `${url}/assets/${currentAsset.id}`,
        headers,
        payload: {
          baseRevision: project.revision,
          baseVersion: currentAsset.version,
        },
      })
    ).statusCode,
    204,
  );
  project = await get();
  assert.equal(project.assets?.length, 0);
  // Fill retained history without changing compiler availability.
  for (let i = 0; i < limits.snapshotsPerProject + 2; i++) {
    const file = project.files[0];
    assert.ok(file);
    await app.inject({
      method: "PUT",
      url: `${url}/files/${file.id}`,
      headers,
      payload: {
        baseVersion: file.version,
        content: `% compiler quota fixture ${i}`,
      },
    });
    project = await get();
    await app.inject({
      method: "POST",
      url: `${url}/snapshots`,
      headers,
      payload: { baseRevision: project.revision },
    });
  }
  assert.equal(
    (await app.inject({ url: `${url}/snapshots`, headers })).json().length,
    limits.snapshotsPerProject,
  );
  assert.equal((await capture(project.revision)).statusCode, 200);
  assert.equal(
    (await app.inject({ url, headers })).headers["cache-control"],
    "private, no-store",
  );
  console.log(
    "Compiler API integration passed: real PostgreSQL, ephemeral capture/retention independence, asset ownership/signatures/versions, immutable asset history/restore, path collisions and main-file selection.",
  );
} finally {
  await database.pool.query('DELETE FROM "user" WHERE email=ANY($1::text[])', [
    emails,
  ]);
  await app.close();
  await database.close();
}
