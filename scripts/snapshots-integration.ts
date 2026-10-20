import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  limits,
  projectSchema,
  textSnapshotSchema,
} from "@overleaf-pro/contracts";
import { createDatabase } from "@overleaf-pro/db";
import { buildApp } from "../apps/api/src/app.js";
import { readConfig } from "../apps/api/src/config.js";
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
  }),
  { database },
);
const emails = [0, 1].map(() => `snapshot-${randomUUID()}@example.test`);
async function signup(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin },
    payload: {
      name: "Snapshot Test",
      email,
      password: "synthetic-snapshot-password-42",
    },
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
  const otherHeaders = await signup(emails[1] ?? "");
  async function newProject() {
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers,
      payload: { name: "Snapshot fixture" },
    });
    assert.equal(response.statusCode, 201);
    return projectSchema.parse(response.json());
  }
  const project = await newProject();
  const url = `/api/projects/${project.id}`;
  const snapshotUrl = `${url}/snapshots`;
  const file = project.files[0];
  assert.ok(file);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: snapshotUrl,
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
        url: snapshotUrl,
        headers: otherHeaders,
        payload: { baseRevision: 1 },
      })
    ).statusCode,
    404,
  );
  for (const payload of [
    {},
    { baseRevision: 0 },
    { baseRevision: 1, files: [] },
  ])
    assert.equal(
      (await app.inject({ method: "POST", url: snapshotUrl, headers, payload }))
        .statusCode,
      400,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: snapshotUrl,
        headers: { cookie: headers.cookie },
        payload: { baseRevision: 1 },
      })
    ).statusCode,
    403,
  );
  const captures = await Promise.all(
    [0, 1].map(() =>
      app.inject({
        method: "POST",
        url: snapshotUrl,
        headers,
        payload: { baseRevision: 1 },
      }),
    ),
  );
  for (const response of captures) assert.equal(response.statusCode, 201);
  const snapshot = textSnapshotSchema.parse(captures[0]?.json());
  assert.deepEqual(
    captures[1]?.json(),
    snapshot,
    "Concurrent same-revision capture reuses the immutable snapshot",
  );
  assert.equal(captures[0]?.headers["cache-control"], "private, no-store");
  assert.deepEqual(snapshot.files, project.files);
  for (const item of snapshot.files)
    assert.equal(
      item.sha256,
      createHash("sha256").update(item.content).digest("hex"),
    );
  const readUrl = `${snapshotUrl}/${snapshot.id}`;
  assert.equal((await app.inject({ url: readUrl })).statusCode, 401);
  assert.equal(
    (await app.inject({ url: readUrl, headers: otherHeaders })).statusCode,
    404,
  );
  const otherProject = await newProject();
  assert.equal(
    (
      await app.inject({
        url: `/api/projects/${otherProject.id}/snapshots/${snapshot.id}`,
        headers,
      })
    ).statusCode,
    404,
  );
  await assert.rejects(
    database.pool.query(
      "UPDATE project_snapshot SET revision = revision + 1 WHERE id = $1",
      [snapshot.id],
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Source snapshots are immutable",
  );
  const save = await app.inject({
    method: "PUT",
    url: `${url}/files/${file.id}`,
    headers,
    payload: { baseVersion: 1, content: "Later edit" },
  });
  assert.equal(save.statusCode, 200);
  assert.deepEqual(
    (await app.inject({ url: readUrl, headers })).json(),
    snapshot,
    "Later source writes do not mutate old snapshots",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: snapshotUrl,
        headers,
        payload: { baseRevision: 1 },
      })
    ).statusCode,
    409,
  );
  const raced = await Promise.all([
    app.inject({
      method: "POST",
      url: snapshotUrl,
      headers,
      payload: { baseRevision: 2 },
    }),
    app.inject({
      method: "PUT",
      url: `${url}/files/${file.id}`,
      headers,
      payload: { baseVersion: 2, content: "Racing edit" },
    }),
  ]);
  assert.equal(raced[1]?.statusCode, 200);
  assert.ok(raced[0]?.statusCode === 201 || raced[0]?.statusCode === 409);
  if (raced[0]?.statusCode === 201) {
    const captured = textSnapshotSchema.parse(raced[0].json());
    assert.equal(captured.revision, 2);
    assert.equal(
      captured.files.find((item) => item.id === file.id)?.content,
      "Later edit",
    );
  }
  // Exercise the project retention limit using actual saved revisions.
  let revision = 3;
  let version = 3;
  while (true) {
    const response = await app.inject({
      method: "POST",
      url: snapshotUrl,
      headers,
      payload: { baseRevision: revision },
    });
    if (response.statusCode === 400) break;
    assert.equal(response.statusCode, 201);
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `${url}/files/${file.id}`,
          headers,
          payload: {
            baseVersion: version++,
            content: `Revision ${++revision}`,
          },
        })
      ).statusCode,
      200,
    );
    assert.ok(revision <= limits.snapshotsPerProject + 3);
  }
  const count = await database.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM project_snapshot WHERE project_id = $1",
    [project.id],
  );
  assert.equal(count.rows[0]?.count, limits.snapshotsPerProject);
  // A full project still allows retrieval of every previously captured revision.
  assert.deepEqual(
    (await app.inject({ url: readUrl, headers })).json(),
    snapshot,
  );
  // Build real bounded source, then fill account retention across two projects.
  const large = await newProject();
  const largeUrl = `/api/projects/${large.id}`;
  for (let index = 0; index < 31; index++) {
    const added = await app.inject({
      method: "POST",
      url: `${largeUrl}/files`,
      headers,
      payload: {
        path: `large-${index}.tex`,
        content: "x".repeat(limits.textFileBytes),
      },
    });
    assert.equal(added.statusCode, 201);
  }
  const largeFile = large.files[0];
  assert.ok(largeFile);
  for (let index = 0; index < 4; index++) {
    const captured = await app.inject({
      method: "POST",
      url: `${largeUrl}/snapshots`,
      headers,
      payload: { baseRevision: 32 + index },
    });
    assert.equal(captured.statusCode, 201);
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `${largeUrl}/files/${largeFile.id}`,
          headers,
          payload: {
            baseVersion: 1 + index,
            content: `Large revision ${index}`,
          },
        })
      ).statusCode,
      200,
    );
  }
  // ~31 MiB retained; a new snapshot in a different project must share the cap.
  const extraFile = otherProject.files[0];
  assert.ok(extraFile);
  for (let index = 0; index < 4; index++)
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${otherProject.id}/files`,
          headers,
          payload: {
            path: `extra-${index}.tex`,
            content: "y".repeat(limits.textFileBytes),
          },
        })
      ).statusCode,
      201,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/projects/${otherProject.id}/snapshots`,
        headers,
        payload: { baseRevision: 5 },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${largeUrl}/snapshots`,
        headers,
        payload: { baseRevision: 36 },
      })
    ).statusCode,
    400,
  );
  // Cascades must remain possible despite the immutable UPDATE trigger.
  await database.pool.query('DELETE FROM "user" WHERE email = $1', [emails[0]]);
  assert.equal(
    (
      await database.pool.query(
        "SELECT id FROM project_snapshot WHERE id = $1",
        [snapshot.id],
      )
    ).rowCount,
    0,
  );
  console.log(
    "Snapshot integration passed: real PostgreSQL migration/idempotence, ownership, origin checks, capture/write races, immutable history, retention limits and deletion cascades.",
  );
} finally {
  await database.pool.query(
    'DELETE FROM "user" WHERE email = ANY($1::text[])',
    [emails],
  );
  await app.close();
  await database.close();
}
