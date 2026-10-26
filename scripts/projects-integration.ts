import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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
const emails = [0, 1].map(() => `workspace-${randomUUID()}@example.test`);
async function signup(email: string) {
  const response = await verifiedSignup(app, origin, {
    name: "Workspace Test",
    email,
    password: "synthetic-workspace-password-42",
  });
  assert.equal(response.statusCode, 200);
  const cookies = response.headers["set-cookie"];
  return (Array.isArray(cookies) ? cookies : [cookies ?? ""])
    .map((value) => value.split(";")[0])
    .join("; ");
}
try {
  await database.migrate();
  await database.migrate();
  const cookie = await signup(emails[0] ?? "");
  const otherCookie = await signup(emails[1] ?? "");
  const headers = { origin, cookie };
  const otherHeaders = { origin, cookie: otherCookie };
  assert.equal((await app.inject("/api/projects")).statusCode, 401);
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers,
    payload: { name: "Private draft" },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.headers["cache-control"], "private, no-store");
  const project = created.json();
  const file = project.files[0];
  const url = `/api/projects/${project.id}`;
  const fileUrl = `${url}/files/${file.id}`;
  assert.equal(
    (await app.inject({ url, headers: otherHeaders })).statusCode,
    404,
  );
  assert.deepEqual(
    (await app.inject({ url: "/api/projects", headers: otherHeaders })).json(),
    [],
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: fileUrl,
        headers: otherHeaders,
        payload: { baseVersion: 1, content: "stolen" },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${url}/files`,
        headers: otherHeaders,
        payload: {
          baseRevision: (await app.inject({ url: `${url}`, headers })).json()
            .revision,
          path: "secret.tex",
          content: "",
        },
      })
    ).statusCode,
    404,
  );
  for (const path of ["../escape.tex", "/etc/passwd", "C:/file.tex", "a\\b"]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `${url}/files`,
          headers,
          payload: {
            baseRevision: (await app.inject({ url: `${url}`, headers })).json()
              .revision,
            path,
            content: "",
          },
        })
      ).statusCode,
      400,
    );
  }
  const added = await app.inject({
    method: "POST",
    url: `${url}/files`,
    headers,
    payload: {
      baseRevision: (await app.inject({ url: `${url}`, headers })).json()
        .revision,
      path: "chapters/one.tex",
      content: "chapter",
    },
  });
  assert.equal(added.statusCode, 201);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${url}/files`,
        headers,
        payload: {
          baseRevision: (await app.inject({ url: `${url}`, headers })).json()
            .revision,
          path: "chapters/one.tex",
          content: "",
        },
      })
    ).statusCode,
    409,
  );
  const saves = await Promise.all(
    ["first", "second"].map((content) =>
      app.inject({
        method: "PUT",
        url: fileUrl,
        headers,
        payload: { baseVersion: 1, content },
      }),
    ),
  );
  assert.deepEqual(
    saves.map((response) => response.statusCode).sort(),
    [200, 409],
  );
  const accepted = saves
    .find((response) => response.statusCode === 200)
    ?.json();
  assert.equal(accepted.version, 2);
  assert.equal(
    accepted.sha256,
    createHash("sha256").update(accepted.content).digest("hex"),
  );
  assert.equal(
    (await app.inject({ url, headers }))
      .json()
      .files.find((item: { id: string }) => item.id === file.id).content,
    accepted.content,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: fileUrl,
        headers,
        payload: { baseVersion: 2, content: "é".repeat(140_000) },
      })
    ).statusCode,
    400,
  );
  for (const content of ["null\0byte", "unpaired\ud800"]) {
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: fileUrl,
          headers,
          payload: { baseVersion: 2, content },
        })
      ).statusCode,
      400,
    );
  }
  const escapedText = '"'.repeat(256 * 1024);
  const escapedSave = await app.inject({
    method: "PUT",
    url: fileUrl,
    headers,
    payload: { baseVersion: 2, content: escapedText },
  });
  assert.equal(
    escapedSave.statusCode,
    200,
    "A valid 256 KiB file must also fit when JSON-escaped",
  );
  assert.equal(escapedSave.json().content, escapedText);
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: fileUrl,
        headers: { cookie, origin: "https://attacker.example" },
        payload: { baseVersion: 2, content: "bad origin" },
      })
    ).statusCode,
    403,
  );
  const quotaProject = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers,
    payload: { name: "Quota test" },
  });
  const quotaId = quotaProject.json().id;
  for (let index = 2; index < 50; index++) {
    const result = await app.inject({
      method: "POST",
      url: `/api/projects/${quotaId}/files`,
      headers,
      payload: {
        baseRevision: (
          await app.inject({ url: `/api/projects/${quotaId}`, headers })
        ).json().revision,
        path: `part-${index}.tex`,
        content: "",
      },
    });
    assert.equal(result.statusCode, 201);
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/projects/${quotaId}/files`,
        headers,
        payload: {
          baseRevision: (
            await app.inject({ url: `/api/projects/${quotaId}`, headers })
          ).json().revision,
          path: "over-limit.tex",
          content: "",
        },
      })
    ).statusCode,
    400,
  );
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-out",
    headers,
    payload: {},
  });
  assert.equal((await app.inject({ url, headers })).statusCode, 401);
  console.log(
    "Project integration passed: account isolation, concurrent version checks, persistence, hashes, path/size/count limits, origin protection and logout.",
  );
} finally {
  await database.pool.query(
    'DELETE FROM "user" WHERE email = ANY($1::text[])',
    [emails],
  );
  await app.close();
  await database.close();
}
