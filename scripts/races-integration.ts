import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { aiRequestSchema, projectSchema } from "@overleaf-pro/contracts";
import { createDatabase, projectRepository } from "@overleaf-pro/db";
import { buildApp } from "../apps/api/src/app.js";
import { createAssistantProvider } from "../apps/api/src/assistant-provider.js";
import { readConfig } from "../apps/api/src/config.js";
import { clearTestMail, verifiedSignup } from "./test-account.js";
import { requireTestDatabase } from "./test-database.js";

const database = createDatabase(requireTestDatabase());
const origin = "http://localhost:5173";
let entered: () => void = () => {},
  release: () => void = () => {};
const upstream = createServer(async (req, res) => {
  for await (const _chunk of req) {
    /* Drain synthetic context without logging it. */
  }
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  entered();
  await wait;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              answer: "Synthetic late answer",
              refused: false,
              edits: [],
            }),
          },
        },
      ],
    }),
  );
});
await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
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
    assistantProvider: createAssistantProvider({
      key: "synthetic-only",
      model: "openai/gpt-oss-20b",
      endpoint: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/openai/v1/chat/completions`,
    }),
  },
);
const emails = [0, 1].map(() => `part7-races-${randomUUID()}@example.test`);
try {
  await database.migrate();
  const headers = [];
  for (const email of emails) {
    const result = await verifiedSignup(app, origin, {
      name: "Race fixture",
      email,
      password: "synthetic-race-password-42",
    });
    const cookies = result.headers["set-cookie"];
    headers.push({
      origin,
      cookie: (Array.isArray(cookies) ? cookies : [cookies ?? ""])
        .map((c) => c.split(";")[0])
        .join("; "),
    });
  }
  const owner = headers[0];
  const foreign = headers[1];
  assert.ok(owner);
  assert.ok(foreign);
  const user = (
    await app.inject({ url: "/api/session", headers: owner })
  ).json().user.id as string;
  const repository = projectRepository(database.pool);
  for (const scenario of [
    "reject",
    "expire",
    "proposal-delete",
    "project-delete",
    "account-delete",
  ]) {
    const id = await repository.create(user, `Late ${scenario}`);
    const project = projectSchema.parse(await repository.get(user, id));
    const input = aiRequestSchema.parse({
      requestId: randomUUID(),
      projectId: id,
      baseRevision: project.revision,
      mode: "explain",
      instruction: "Synthetic late reply",
      fileIds: [project.files[0]?.id],
      diagnostics: "",
      shareWithProvider: true,
    });
    const pending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const completion: Promise<{
      statusCode: number;
      json: () => { status: string };
    }> = app.inject({
      method: "POST",
      url: "/api/ai-proposals",
      headers: owner,
      payload: input,
    });
    // app.inject starts when awaited/thened.
    await pending;
    for (const path of [
      `/api/ai-proposals/${input.requestId}`,
      `/api/projects/${id}`,
    ])
      assert.equal(
        (await app.inject({ url: path, headers: foreign })).statusCode,
        404,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${id}/export-input`,
          headers: foreign,
          payload: { baseRevision: 1 },
        })
      ).statusCode,
      404,
    );
    if (scenario === "reject")
      await repository.rejectProposal(user, input.requestId);
    if (scenario === "expire") {
      await database.pool.query(
        "UPDATE ai_proposal SET data=data || $2::jsonb WHERE id=$1",
        [
          input.requestId,
          JSON.stringify({
            createdAt: new Date(Date.now() - 60000).toISOString(),
          }),
        ],
      );
      assert.equal(
        (await repository.proposal(user, input.requestId)).status,
        "expired",
      );
    }
    if (scenario === "proposal-delete")
      await repository.deleteProposal(user, input.requestId);
    if (scenario === "project-delete")
      await repository.delete(user, id, project.revision);
    if (scenario === "account-delete")
      await database.pool.query('DELETE FROM "user" WHERE id=$1', [user]);
    release();
    const result = await completion;
    if (scenario === "reject" || scenario === "expire") {
      assert.equal(result.statusCode, 201);
      assert.equal(
        result.json().status,
        scenario === "reject" ? "rejected" : "expired",
      );
      assert.deepEqual(
        projectSchema.parse(await repository.get(user, id)),
        project,
      );
    } else {
      assert.equal(result.statusCode, 404);
      assert.equal(
        (
          await database.pool.query("SELECT 1 FROM ai_proposal WHERE id=$1", [
            input.requestId,
          ])
        ).rowCount,
        0,
      );
    }
  }
  console.log(
    "Race integration passed: actual delayed HTTP completion cannot revive rejected/expired/deleted proposals, deleted projects or deleted accounts; foreign IDs stay private.",
  );
} finally {
  release();
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  for (const email of emails)
    await database.pool.query('DELETE FROM "user" WHERE email=$1', [email]);
  await clearTestMail(emails);
  await app.close();
  await database.close();
}
