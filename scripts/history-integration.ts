import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  limits,
  projectSchema,
  type SourceFile,
  snapshotListSchema,
  templateCatalog,
  textSnapshotSchema,
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
const emails = [0, 1].map(() => `snapshot-${randomUUID()}@example.test`);
async function signup(email: string) {
  const response = await verifiedSignup(app, origin, {
    name: "Snapshot Test",
    email,
    password: "synthetic-snapshot-password-42",
  });
  assert.equal(response.statusCode, 200);
  const cookies = response.headers["set-cookie"];
  return {
    origin,
    cookie: (Array.isArray(cookies) ? cookies : [cookies ?? ""])
      .map((value) => value.split(";")[0])
      .join("; "),
  };
}
try {
  await database.migrate();
  await database.migrate();
  const headers = await signup(emails[0] ?? "");
  const outsider = await signup(emails[1] ?? "");
  async function create(templateId: string) {
    const result = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers,
      payload: { name: "Template copy", templateId },
    });
    assert.equal(result.statusCode, 201);
    return projectSchema.parse(result.json());
  }
  for (const template of templateCatalog) {
    const first = await create(template.id);
    const second = await create(template.id);
    assert.deepEqual(
      first.files.map((f) => [f.path, f.content]),
      second.files.map((f) => [f.path, f.content]),
    );
    assert.ok(
      first.files.every(
        (f) => !second.files.some((other) => other.id === f.id),
      ),
    );
    assert.ok(
      first.files.some(
        (f) => f.path === "LICENSE.txt" && f.content.includes("MIT License"),
      ),
    );
    const file = first.files.find((f) => f.path === "main.tex");
    assert.ok(file);
    const captured = await app.inject({
      method: "POST",
      url: `/api/projects/${first.id}/snapshots`,
      headers,
      payload: { baseRevision: 1 },
    });
    assert.equal(captured.statusCode, 201);
    const originalCopy = textSnapshotSchema.parse(captured.json());
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `/api/projects/${first.id}/files/${file.id}`,
          headers,
          payload: { baseVersion: 1, content: "independent edit" },
        })
      ).statusCode,
      200,
    );
    const recovered = await app.inject({
      method: "POST",
      url: `/api/projects/${first.id}/snapshots/${originalCopy.id}/restore`,
      headers,
      payload: { baseRevision: 2 },
    });
    assert.equal(recovered.statusCode, 200);
    assert.deepEqual(
      projectSchema
        .parse(recovered.json())
        .files.map((item) => [item.path, item.content]),
      first.files.map((item) => [item.path, item.content]),
    );
    assert.deepEqual(
      projectSchema.parse(
        (
          await app.inject({ url: `/api/projects/${second.id}`, headers })
        ).json(),
      ),
      second,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/projects",
        headers,
        payload: { name: "Bad", templateId: "../../private" },
      })
    ).statusCode,
    400,
  );
  const project = await create("report");
  const url = `/api/projects/${project.id}`;
  const file = project.files.find((f) => f.path === "main.tex");
  assert.ok(file);
  const capture = async (baseRevision: number, name?: string) =>
    app.inject({
      method: "POST",
      url: `${url}/snapshots`,
      headers,
      payload: { baseRevision, ...(name ? { name } : {}) },
    });
  const original = textSnapshotSchema.parse((await capture(1)).json());
  assert.equal((await capture(1, "Original report")).statusCode, 201);
  assert.equal((await capture(1, "Original report")).statusCode, 201);
  assert.equal((await capture(1, "Different name")).statusCode, 409);
  const listing = snapshotListSchema.parse(
    (await app.inject({ url: `${url}/snapshots`, headers })).json(),
  );
  assert.equal(listing.length, 1);
  assert.equal(listing[0]?.name, "Original report");
  const restoreUrl = `${url}/snapshots/${original.id}/restore`;
  for (const route of [`${url}/snapshots`, `${url}/snapshots/${original.id}`]) {
    assert.equal(
      (await app.inject({ url: route, headers: outsider })).statusCode,
      404,
    );
    assert.equal((await app.inject({ url: route })).statusCode, 401);
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: restoreUrl,
        headers: outsider,
        payload: { baseRevision: 1 },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: restoreUrl,
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
        url: restoreUrl,
        headers: { cookie: headers.cookie },
        payload: { baseRevision: 1 },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: restoreUrl,
        headers,
        payload: { baseRevision: 1, files: [] },
      })
    ).statusCode,
    400,
  );
  const other = await create("report");
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/projects/${other.id}/snapshots/${original.id}/restore`,
        headers,
        payload: { baseRevision: 1 },
      })
    ).statusCode,
    404,
  );
  const fileId = file.id;
  async function save(baseVersion: number, content: string) {
    return app.inject({
      method: "PUT",
      url: `${url}/files/${fileId}`,
      headers,
      payload: { baseVersion, content },
    });
  }
  assert.equal((await save(1, "Edited report")).statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${url}/files`,
        headers,
        payload: {
          baseRevision: (await app.inject({ url: `${url}`, headers })).json()
            .revision,
          path: "extra.tex",
          content: "later file",
        },
      })
    ).statusCode,
    201,
  );
  const before = projectSchema.parse(
    (await app.inject({ url, headers })).json(),
  );
  assert.equal(before.revision, 3);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: restoreUrl,
        headers,
        payload: { baseRevision: 1 },
      })
    ).statusCode,
    409,
  );
  const restores = await Promise.all(
    [0, 1].map(() =>
      app.inject({
        method: "POST",
        url: restoreUrl,
        headers,
        payload: { baseRevision: 3 },
      }),
    ),
  );
  assert.deepEqual(restores.map((r) => r.statusCode).sort(), [200, 409]);
  const response = restores.find((r) => r.statusCode === 200);
  assert.ok(response);
  assert.equal(response.headers["cache-control"], "private, no-store");
  const restored = projectSchema.parse(response.json());
  assert.equal(restored.revision, 4);
  assert.deepEqual(
    restored.files.map((f) => [f.path, f.content, f.sha256]),
    original.files.map((f) => [f.path, f.content, f.sha256]),
  );
  assert.equal(restored.files.find((f) => f.id === file.id)?.version, 3);
  assert.equal((await save(2, "stale overwrite")).statusCode, 409);
  const history = snapshotListSchema.parse(
    (await app.inject({ url: `${url}/snapshots`, headers })).json(),
  );
  const backupId = history.find((item) => item.revision === 3)?.id;
  assert.ok(backupId);
  const backup = textSnapshotSchema.parse(
    (await app.inject({ url: `${url}/snapshots/${backupId}`, headers })).json(),
  );
  assert.deepEqual(backup.files, before.files);
  assert.deepEqual(
    textSnapshotSchema.parse(
      (
        await app.inject({ url: `${url}/snapshots/${original.id}`, headers })
      ).json(),
    ),
    original,
  );
  // Restoring the automatic backup recovers deleted files with fresh IDs.
  const extra = before.files.find((f) => f.path === "extra.tex");
  assert.ok(extra);
  const undo = projectSchema.parse(
    (
      await app.inject({
        method: "POST",
        url: `${url}/snapshots/${backupId}/restore`,
        headers,
        payload: { baseRevision: 4 },
      })
    ).json(),
  );
  assert.equal(
    undo.files.find((f) => f.path === "extra.tex")?.content,
    extra.content,
  );
  assert.notEqual(undo.files.find((f) => f.path === "extra.tex")?.id, extra.id);
  // Race a real save with restore: whichever wins makes the other stale.
  const race = await Promise.all([
    save(4, "racing edit"),
    app.inject({
      method: "POST",
      url: restoreUrl,
      headers,
      payload: { baseRevision: 5 },
    }),
  ]);
  assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 409]);
  let live = projectSchema.parse((await app.inject({ url, headers })).json());
  let count = snapshotListSchema.parse(
    (await app.inject({ url: `${url}/snapshots`, headers })).json(),
  ).length;
  while (count < limits.snapshotsPerProject) {
    assert.equal((await capture(live.revision)).statusCode, 201);
    count = snapshotListSchema.parse(
      (await app.inject({ url: `${url}/snapshots`, headers })).json(),
    ).length;
    const liveFile: SourceFile | undefined = live.files.find(
      (f) => f.id === file.id,
    );
    assert.ok(liveFile);
    assert.equal(
      (await save(liveFile.version, `quota revision ${count}`)).statusCode,
      200,
    );
    live = projectSchema.parse((await app.inject({ url, headers })).json());
  }
  const denied = await app.inject({
    method: "POST",
    url: restoreUrl,
    headers,
    payload: { baseRevision: live.revision },
  });
  assert.equal(denied.statusCode, 400);
  assert.deepEqual(
    projectSchema.parse((await app.inject({ url, headers })).json()),
    live,
  );
  assert.equal(
    snapshotListSchema.parse(
      (await app.inject({ url: `${url}/snapshots`, headers })).json(),
    ).length,
    limits.snapshotsPerProject,
  );
  await database.pool.query('DELETE FROM "user" WHERE email = $1', [emails[0]]);
  assert.equal(
    (
      await database.pool.query(
        "SELECT snapshot_id FROM snapshot_name WHERE snapshot_id = $1",
        [original.id],
      )
    ).rowCount,
    0,
  );
  console.log(
    "History integration passed: template isolation, named immutable revisions, ownership/origin protection, atomic restore/backup, monotonic versions, save/restore races, quota rollback and cascades.",
  );
} finally {
  await database.pool.query(
    'DELETE FROM "user" WHERE email = ANY($1::text[])',
    [emails],
  );
  await app.close();
  await database.close();
}
