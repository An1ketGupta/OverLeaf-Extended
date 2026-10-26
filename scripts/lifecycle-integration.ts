import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { limits, projectSchema } from "@overleaf-pro/contracts";
import { createDatabase } from "@overleaf-pro/db";
import { buildApp } from "../apps/api/src/app.js";
import { readConfig } from "../apps/api/src/config.js";
import { extracted } from "../tests/fixtures/resume.js";
import { clearTestMail, verifiedSignup } from "./test-account.js";
import { requireTestDatabase } from "./test-database.js";

const database = createDatabase(requireTestDatabase());
const origin = "http://localhost:5173";
const emails = [0, 1].map(() => `lifecycle-${randomUUID()}@example.test`);
const app = buildApp(
  readConfig({
    NODE_ENV: "test",
    APP_ORIGIN: origin,
    TRUSTED_ORIGINS: origin,
    AUTH_SECRET: randomUUID(),
    AUTH_ALLOW_SIGNUP: "true",
    MAIL_ENABLED: "true",
  }),
  {
    database,
    assistantProvider: async () => ({
      result: { answer: "Synthetic explanation", refused: false, edits: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  },
);
try {
  await database.migrate();
  await database.migrate();
  const headers = [];
  for (const email of emails) {
    const response = await verifiedSignup(app, origin, {
      name: "Lifecycle Test",
      email,
      password: "synthetic-lifecycle-password-42",
    });
    headers.push({
      origin,
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    });
  }
  const owner = headers[0];
  const foreign = headers[1];
  assert.ok(owner);
  assert.ok(foreign);
  const request = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload?: Record<string, unknown>,
    other = false,
  ) =>
    app.inject({
      method,
      url,
      headers: other ? foreign : owner,
      ...(payload === undefined ? {} : { payload }),
    });
  const create = async (name = "Lifecycle") =>
    projectSchema.parse(
      (await request("POST", "/api/projects", { name })).json(),
    );
  let project = await create();
  const id = project.id;
  const url = `/api/projects/${id}`;
  const get = async () =>
    projectSchema.parse((await request("GET", url)).json());
  let main = project.files.find((file) => file.path === project.mainFile);
  assert.ok(main);
  const notes = project.files.find((file) => file.id !== main?.id);
  assert.ok(notes);
  for (const [method, path, body] of [
    ["PUT", url, { baseRevision: 1, name: "Stolen" }],
    ["DELETE", url, { baseRevision: 1 }],
    [
      "POST",
      `${url}/files/${notes.id}/rename`,
      { baseRevision: 1, baseVersion: 1, path: "stolen.tex" },
    ],
    ["DELETE", `${url}/files/${notes.id}`, { baseRevision: 1, baseVersion: 1 }],
  ] as const)
    assert.equal((await request(method, path, body, true)).statusCode, 404);
  assert.equal(
    (await request("PUT", url, { baseRevision: 1, name: "Renamed project" }))
      .statusCode,
    200,
  );
  assert.equal(
    (await request("DELETE", url, { baseRevision: 1 })).statusCode,
    409,
  );
  project = await get();
  assert.equal(project.name, "Renamed project");
  assert.equal(
    (await request("POST", `${url}/files`, { path: "new.tex", content: "" }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await request("POST", `${url}/files`, {
        baseRevision: 1,
        path: "new.tex",
        content: "",
      })
    ).statusCode,
    409,
  );
  const renameUrl = `${url}/files/${main.id}/rename`;
  assert.equal(
    (
      await request("POST", renameUrl, {
        baseRevision: project.revision,
        baseVersion: main.version,
        path: "../escape.tex",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("POST", renameUrl, {
        baseRevision: project.revision,
        baseVersion: main.version,
        path: notes.path,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await request("POST", renameUrl, {
        baseRevision: project.revision,
        baseVersion: main.version,
        path: "sections",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await request("POST", renameUrl, {
        baseRevision: project.revision,
        baseVersion: main.version,
        path: "main.txt",
      })
    ).statusCode,
    400,
  );
  const renamed = await request("POST", renameUrl, {
    baseRevision: project.revision,
    baseVersion: main.version,
    path: "nested/start.tex",
  });
  assert.equal(renamed.statusCode, 200);
  project = projectSchema.parse(renamed.json());
  assert.equal(project.mainFile, "nested/start.tex");
  assert.equal(project.files.find((file) => file.id === main?.id)?.version, 2);
  assert.equal(
    (
      await request("PUT", `${url}/files/${main.id}`, {
        baseVersion: 1,
        content: "stale",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await request("DELETE", `${url}/files/${main.id}`, {
        baseRevision: project.revision,
        baseVersion: 2,
      })
    ).statusCode,
    400,
  );
  // Save and rename share both project serialization and the file's version.
  const race = await Promise.all([
    request("POST", `${url}/files/${notes.id}/rename`, {
      baseRevision: project.revision,
      baseVersion: notes.version,
      path: "raced.tex",
    }),
    request("PUT", `${url}/files/${notes.id}`, {
      baseVersion: notes.version,
      content: "race edit",
    }),
  ]);
  assert.deepEqual(
    race.map((response) => response.statusCode).sort(),
    [200, 409],
  );
  project = await get();
  const target = project.files.find((file) => file.id === notes.id);
  assert.ok(target);
  const before = structuredClone(project);
  assert.equal(
    (
      await request("DELETE", `${url}/files/${target.id}`, {
        baseRevision: project.revision,
        baseVersion: target.version,
      })
    ).statusCode,
    200,
  );
  project = await get();
  assert.ok(!project.files.some((file) => file.id === target.id));
  assert.equal(
    (
      await request("PUT", `${url}/files/${target.id}`, {
        baseVersion: target.version,
        content: "resurrect",
      })
    ).statusCode,
    404,
  );
  const snapshots = (await request("GET", `${url}/snapshots`)).json() as {
    id: string;
    revision: number;
  }[];
  const backup = snapshots.find(
    (snapshot) => snapshot.revision === before.revision,
  );
  assert.ok(backup);
  const frozen = (await request("GET", `${url}/snapshots/${backup.id}`)).json();
  assert.equal(
    frozen.files.find((file: { id: string }) => file.id === target.id)?.content,
    target.content,
  );
  assert.equal(
    (
      await request("POST", `${url}/snapshots/${backup.id}/restore`, {
        baseRevision: project.revision,
      })
    ).statusCode,
    200,
  );
  project = await get();
  const restored = project.files.find((file) => file.path === target.path);
  assert.ok(restored);
  assert.equal(restored.content, target.content);
  assert.equal(restored.sha256, target.sha256);
  assert.notEqual(restored.id, target.id);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
  const upload = await request("POST", `${url}/assets`, {
    baseRevision: project.revision,
    path: "img.png",
    dataBase64: png,
  });
  assert.equal(upload.statusCode, 201);
  const asset = upload.json();
  project = await get();
  assert.equal(
    (
      await request(
        "POST",
        `${url}/assets/${asset.id}/rename`,
        {
          baseRevision: project.revision,
          baseVersion: asset.version,
          path: "renamed.png",
        },
        true,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await request("POST", `${url}/assets/${asset.id}/rename`, {
        baseRevision: project.revision,
        baseVersion: asset.version,
        path: "renamed.jpg",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("POST", `${url}/assets/${asset.id}/rename`, {
        baseRevision: project.revision,
        baseVersion: asset.version,
        path: "images/renamed.png",
      })
    ).statusCode,
    200,
  );
  project = await get();
  const renamedAsset = project.assets?.[0];
  assert.ok(renamedAsset);
  assert.equal(renamedAsset.version, 2);
  assert.equal(renamedAsset.sha256, asset.sha256);
  assert.equal(
    (
      await request("DELETE", `${url}/assets/${asset.id}`, {
        baseRevision: project.revision,
        baseVersion: 1,
      })
    ).statusCode,
    409,
  );
  const revisionWithAsset = project.revision;
  assert.equal(
    (
      await request("DELETE", `${url}/assets/${asset.id}`, {
        baseRevision: project.revision,
        baseVersion: 2,
      })
    ).statusCode,
    204,
  );
  const assetBackup = (await request("GET", `${url}/snapshots`))
    .json()
    .find(
      (snapshot: { revision: number }) =>
        snapshot.revision === revisionWithAsset,
    );
  assert.equal(
    (await request("GET", `${url}/snapshots/${assetBackup.id}`)).json()
      .assets[0]?.dataBase64,
    png,
  );
  const otherProject = await create("Different parent");
  assert.equal(
    (
      await request(
        "POST",
        `/api/projects/${otherProject.id}/files/${restored.id}/rename`,
        {
          baseRevision: otherProject.revision,
          baseVersion: restored.version,
          path: "mismatch.tex",
        },
      )
    ).statusCode,
    404,
  );
  // Build actual project-scoped proposal and account-scoped report for cascade checks.
  project = await get();
  main = project.files.find((file) => file.path === project.mainFile);
  assert.ok(main);
  const proposal = await request("POST", "/api/ai-proposals", {
    requestId: randomUUID(),
    projectId: id,
    baseRevision: project.revision,
    mode: "explain",
    instruction: "Explain this synthetic source",
    fileIds: [main.id],
    diagnostics: "",
    shareWithProvider: true,
  });
  assert.equal(proposal.statusCode, 201);
  const report = await request("POST", "/api/resume-analyses", {
    extraction: extracted(),
    requirements: [],
  });
  assert.equal(report.statusCode, 201);
  const userId = (await request("GET", "/api/session")).json().user.id;
  // Ensure every cascade assertion below starts with real dependent rows.
  const liveAsset = await request("POST", `${url}/assets`, {
    baseRevision: project.revision,
    path: "cleanup.png",
    dataBase64: png,
  });
  assert.equal(liveAsset.statusCode, 201);
  project = await get();
  const named = await request("POST", `${url}/snapshots`, {
    baseRevision: project.revision,
    name: "Deletion cleanup fixture",
  });
  assert.equal(named.statusCode, 201);
  const namedId = named.json().id as string;
  assert.equal(
    (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM snapshot_name WHERE snapshot_id=$1",
        [namedId],
      )
    ).rows[0]?.count,
    1,
  );
  // Fill retention and move beyond its last captured revision. Deletion must roll back.
  for (let index = 0; index < limits.snapshotsPerProject + 1; index++) {
    project = await get();
    main = project.files.find((file) => file.path === project.mainFile);
    assert.ok(main);
    await request("POST", `${url}/snapshots`, {
      baseRevision: project.revision,
    });
    assert.equal(
      (
        await request("PUT", `${url}/files/${main.id}`, {
          baseVersion: main.version,
          content: `% quota ${index}`,
        })
      ).statusCode,
      200,
    );
  }
  project = await get();
  const retained = project.files.find((file) => file.path === target.path);
  assert.ok(retained);
  assert.equal(
    (
      await request("DELETE", `${url}/files/${retained.id}`, {
        baseRevision: project.revision,
        baseVersion: retained.version,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await get()).revision,
    project.revision,
    "Failed preservation cannot partly delete a file",
  );
  // A project delete can still release a full history quota. Race a save against it.
  main = project.files.find((file) => file.path === project.mainFile);
  assert.ok(main);
  const deletion = await Promise.all([
    request("DELETE", url, { baseRevision: project.revision }),
    request("PUT", `${url}/files/${main.id}`, {
      baseVersion: main.version,
      content: "racing deletion",
    }),
  ]);
  assert.ok(
    (deletion[0]?.statusCode === 204 && deletion[1]?.statusCode === 404) ||
      (deletion[0]?.statusCode === 409 && deletion[1]?.statusCode === 200),
  );
  if (deletion[0]?.statusCode === 409)
    assert.equal(
      (await request("DELETE", url, { baseRevision: (await get()).revision }))
        .statusCode,
      204,
    );
  assert.equal((await request("GET", url)).statusCode, 404);
  for (const table of [
    "project_file",
    "project_asset",
    "project_snapshot",
    "ai_proposal",
  ])
    assert.equal(
      (
        await database.pool.query(
          `SELECT count(*)::int AS count FROM ${table} WHERE project_id=$1`,
          [id],
        )
      ).rows[0]?.count,
      0,
    );
  assert.equal(
    (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM snapshot_name WHERE snapshot_id=$1",
        [namedId],
      )
    ).rows[0]?.count,
    0,
  );
  assert.equal(
    (await request("GET", `/api/ai-proposals/${proposal.json().id}`))
      .statusCode,
    404,
  );
  assert.equal(
    (await request("GET", `/api/resume-analyses/${report.json().id}`))
      .statusCode,
    200,
    "Project deletion must preserve independent account reports",
  );
  assert.equal(
    (
      await request(
        "GET",
        `/api/resume-analyses/${report.json().id}`,
        undefined,
        true,
      )
    ).statusCode,
    404,
  );
  const replacement = await create("Released storage");
  assert.equal(
    (
      await request("POST", `/api/projects/${replacement.id}/snapshots`, {
        baseRevision: 1,
      })
    ).statusCode,
    201,
  );
  assert.equal(
    (
      await database.pool.query(
        "SELECT COALESCE(sum(s.bytes),0)::int AS bytes FROM project_snapshot s JOIN project p ON p.id=s.project_id WHERE p.user_id=$1",
        [userId],
      )
    ).rows[0]?.bytes <
      32 * 1024 * 1024,
    true,
  );
  await database.pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  for (const table of ["session", "account", "project", "resume_analysis"])
    assert.equal(
      (
        await database.pool.query(
          `SELECT count(*)::int AS count FROM "${table}" WHERE user_id=$1`,
          [userId],
        )
      ).rows[0]?.count,
      0,
    );
  console.log(
    "Lifecycle integration passed: ownership/mismatched IDs, rename/version races, main-file/path invariants, exact deletion backups/restore, asset rename/delete, retention rollback, project delete/save race, cascade cleanup and reusable quota.",
  );
} finally {
  await database.pool.query('DELETE FROM "user" WHERE email=ANY($1::text[])', [
    emails,
  ]);
  await app.close();
  await clearTestMail(emails);
  await database.close();
}
