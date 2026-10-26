import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  importProjectSchema,
  limits,
  projectSchema,
} from "@overleaf-pro/contracts";
import { createDatabase, projectRepository } from "@overleaf-pro/db";
import { buildApp } from "../apps/api/src/app.js";
import { readConfig } from "../apps/api/src/config.js";
import { clearTestMail, verifiedSignup } from "./test-account.js";
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
const email = `part7-backup-${randomUUID()}@example.test`;
try {
  await database.migrate();
  const signup = await verifiedSignup(app, origin, {
    name: "Backup recovery",
    email,
    password: "synthetic-recovery-password-42",
  });
  const cookies = signup.headers["set-cookie"];
  const headers = {
    origin,
    cookie: (Array.isArray(cookies) ? cookies : [cookies ?? ""])
      .map((c) => c.split(";")[0])
      .join("; "),
  };
  const user = (await app.inject({ url: "/api/session", headers })).json().user
    .id as string;
  const repository = projectRepository(database.pool);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const input = {
    name: "Recovered project",
    mainFile: "nested/文.tex",
    files: [{ path: "nested/文.tex", content: "Zoë 李\n" }],
    assets: [{ path: "image.png", dataBase64: png.toString("base64") }],
  };
  const request = (
    payload: unknown,
    h: typeof headers | { origin: string } = headers,
  ) =>
    app.inject({
      method: "POST",
      url: "/api/projects/import",
      payload: JSON.stringify(payload),
      headers: { ...h, "content-type": "application/json" },
    });
  assert.equal((await request(input, { origin })).statusCode, 401);
  assert.equal(
    (await request(input, { ...headers, origin: "http://foreign.test" }))
      .statusCode,
    403,
  );
  assert.equal((await request({ ...input, owner: user })).statusCode, 400);
  for (const dataBase64 of ["!!!!", "A===", "_bad"])
    assert.equal(
      (await request({ ...input, assets: [{ path: "image.png", dataBase64 }] }))
        .statusCode,
      400,
    );
  assert.equal(
    (await request({ ...input, files: [...input.files, ...input.files] }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await request({
        ...input,
        assets: [{ path: "bad.png", dataBase64: "YQ==" }],
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await repository.list(user)).length,
    0,
    "Invalid imports must not create partial projects",
  );
  const firstResponse = await request(input);
  assert.equal(firstResponse.statusCode, 201);
  assert.equal(firstResponse.headers["cache-control"], "private, no-store");
  const first = projectSchema.parse(firstResponse.json());
  const second = projectSchema.parse((await request(input)).json());
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.files[0]?.id, second.files[0]?.id);
  assert.equal(first.files[0]?.version, 1);
  assert.equal(first.revision, 1);
  assert.equal(
    first.assets?.[0]?.sha256,
    createHash("sha256").update(png).digest("hex"),
  );
  // Test rollback AFTER source insertion, not just input validation.
  await database.pool.query(
    `CREATE FUNCTION part7_import_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.path='fail-after-source.png' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`,
  );
  await database.pool.query(
    "CREATE TRIGGER part7_import_failure BEFORE INSERT ON project_asset FOR EACH ROW EXECUTE FUNCTION part7_import_failure()",
  );
  try {
    assert.equal(
      (
        await request({
          ...input,
          assets: [
            {
              path: "fail-after-source.png",
              dataBase64: png.toString("base64"),
            },
          ],
        })
      ).statusCode,
      500,
    );
  } finally {
    await database.pool.query(
      "DROP TRIGGER part7_import_failure ON project_asset",
    );
    await database.pool.query("DROP FUNCTION part7_import_failure()");
  }
  assert.equal((await repository.list(user)).length, 2);
  // Full retained history must not block the consistent ephemeral export capture.
  let project = first;
  for (let revision = 0; revision < limits.snapshotsPerProject; revision++) {
    await repository.createSnapshot(user, project.id, project.revision);
    const file = project.files[0];
    assert.ok(file);
    await repository.save(
      user,
      project.id,
      file.id,
      file.version,
      `revision ${revision}`,
    );
    project = projectSchema.parse(await repository.get(user, project.id));
  }
  await assert.rejects(
    repository.createSnapshot(user, project.id, project.revision),
    /storage limit/,
  );
  const capture = await repository.compileInput(
    user,
    project.id,
    project.revision,
  );
  assert.equal(capture.snapshot.files[0]?.content, "revision 19");
  assert.equal((await repository.listSnapshots(user, project.id)).length, 20);
  // Exact decoded limits, transport escaping and fresh source versions.
  const maximum = importProjectSchema.parse({
    ...input,
    assets: [],
    files: [
      { path: input.mainFile, content: "\u0001".repeat(limits.textFileBytes) },
    ],
  });
  assert.equal(
    (await request(maximum)).statusCode,
    201,
    "JSON escaping overhead must not reject valid bounded source",
  );
  assert.equal(
    (
      await request({
        ...maximum,
        files: [
          {
            path: input.mainFile,
            content: "x".repeat(limits.textFileBytes + 1),
          },
        ],
      })
    ).statusCode,
    400,
  );
  const escapedProject = projectSchema.parse(
    (
      await request({
        ...input,
        assets: [],
        files: Array.from({ length: 12 }, (_, index) => ({
          path: index ? `escaped-${index}.tex` : input.mainFile,
          content: "\u0001".repeat(limits.textFileBytes),
        })),
      })
    ).json(),
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/projects/${escapedProject.id}/compile-input`,
        headers,
        payload: { baseRevision: 1 },
      })
    ).statusCode,
    400,
    "The compiler keeps its separate encoded transport bound",
  );
  const escapedExport = await app.inject({
    method: "POST",
    url: `/api/projects/${escapedProject.id}/export-input`,
    headers,
    payload: { baseRevision: 1 },
  });
  assert.equal(
    escapedExport.statusCode,
    200,
    "Valid escaped source must remain exportable above the compiler transport cap",
  );
  assert.equal(escapedExport.json().snapshot.files.length, 12);
  console.log(
    "Backup integration passed: validated import/auth, fresh IDs, atomic rollback, escaped transport and export capture at full history.",
  );
} finally {
  await database.pool.query('DELETE FROM "user" WHERE email=$1', [email]);
  await clearTestMail([email]);
  await app.close();
  await database.close();
}
