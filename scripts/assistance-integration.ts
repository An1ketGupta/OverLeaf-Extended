import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  type AiRequest,
  aiProposalSchema,
  projectSchema,
  savedResumeSchema,
} from "@overleaf-pro/contracts";
import { createDatabase, projectRepository } from "@overleaf-pro/db";
import { buildApp } from "../apps/api/src/app.js";
import { readConfig } from "../apps/api/src/config.js";
import { extracted } from "../tests/fixtures/resume.js";
import { verifiedSignup } from "./test-account.js";
import { requireTestDatabase } from "./test-database.js";

const database = createDatabase(requireTestDatabase());
let calls = 0;
let scenario = "edit";
const config = readConfig({
  NODE_ENV: "test",
  AUTH_ALLOW_SIGNUP: "true",
  MAIL_ENABLED: "true",
  AUTH_SECRET: randomUUID(),
});
const app = buildApp(config, {
  database,
  assistantProvider: async (_input, files) => {
    calls++;
    if (scenario === "fail")
      throw new Error("synthetic provider failure containing private body");
    return {
      result: {
        answer: "Review these synthetic changes",
        refused: scenario === "refuse",
        edits:
          scenario === "refuse"
            ? []
            : files.map((f) => ({
                fileId: scenario === "invalid" ? randomUUID() : f.id,
                content: `${f.content}\n% assisted\n`,
              })),
      },
      usage: { inputTokens: 20, outputTokens: 10 },
    };
  },
});
const emails = [0, 1].map(() => `assistant-${randomUUID()}@example.test`);
async function signup(email: string) {
  const response = await verifiedSignup(app, config.APP_ORIGIN, {
    name: "Synthetic Writer",
    email,
    password: "synthetic-assistant-password-42",
  });
  assert.equal(response.statusCode, 200);
  return {
    origin: config.APP_ORIGIN,
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
  };
}
try {
  await database.migrate();
  await database.migrate();
  const headers = await signup(emails[0] ?? "");
  const foreign = await signup(emails[1] ?? "");
  const user = (await app.inject({ url: "/api/session", headers })).json().user
    .id as string;
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers,
    payload: { name: "Assistant fixture" },
  });
  let project = projectSchema.parse(created.json());
  const get = async () =>
    projectSchema.parse(
      (
        await app.inject({ url: `/api/projects/${project.id}`, headers })
      ).json(),
    );
  const input = (): AiRequest => ({
    requestId: randomUUID(),
    projectId: project.id,
    baseRevision: project.revision,
    mode: "rewrite",
    instruction: "Add a comment",
    fileIds: project.files.map((f) => f.id),
    diagnostics: "",
    shareWithProvider: true,
  });
  const create = async (body = input()) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ai-proposals",
      headers,
      payload: body,
    });
    assert.ok([200, 201].includes(response.statusCode), response.body);
    return aiProposalSchema.parse(response.json());
  };
  const action = (id: string, action: string, owner = headers) =>
    app.inject({
      method: "POST",
      url: `/api/ai-proposals/${id}/${action}`,
      headers: owner,
      payload: {},
    });
  const request = input();
  const proposal = await create(request);
  assert.equal(proposal.status, "ready");
  assert.equal((await create(request)).id, proposal.id);
  assert.equal(calls, 1, "same request ID must not call the provider again");
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/ai-proposals",
        headers,
        payload: { ...request, instruction: "different" },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/ai-proposals/${proposal.id}`,
        headers: foreign,
      })
    ).statusCode,
    404,
  );
  assert.equal((await action(proposal.id, "apply", foreign)).statusCode, 404);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/ai-proposals",
        headers,
        payload: { ...input(), shareWithProvider: false },
      })
    ).statusCode,
    400,
  );
  const appliedResponse = await action(proposal.id, "apply");
  assert.equal(appliedResponse.statusCode, 200, appliedResponse.body);
  const applied = aiProposalSchema.parse(appliedResponse.json());
  assert.equal(applied.status, "applied");
  const current = await get();
  assert.equal(current.revision, project.revision + 1);
  assert.ok(
    current.files.every(
      (f) => f.version === 2 && f.content.endsWith("% assisted\n"),
    ),
  );
  assert.equal((await action(proposal.id, "apply")).statusCode, 200);
  assert.equal(
    (await get()).revision,
    current.revision,
    "apply retry must not increment versions twice",
  );
  const backup = await app.inject({
    url: `/api/projects/${project.id}/snapshots/${applied.backupSnapshotId}`,
    headers,
  });
  assert.deepEqual(
    backup.json().files.map((f: { content: string }) => f.content),
    project.files.map((f) => f.content),
  );
  const restored = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/snapshots/${applied.backupSnapshotId}/restore`,
    headers,
    payload: { baseRevision: current.revision },
  });
  assert.equal(restored.statusCode, 200);
  project = await get();
  const stale = await create();
  const file = project.files[0];
  assert.ok(file);
  const save = await app.inject({
    method: "PUT",
    url: `/api/projects/${project.id}/files/${file.id}`,
    headers,
    payload: { baseVersion: file.version, content: "Later writer work" },
  });
  assert.equal(save.statusCode, 200);
  assert.equal((await action(stale.id, "apply")).statusCode, 409);
  const after = await get();
  assert.equal(
    after.files.find((f) => f.id === file.id)?.content,
    "Later writer work",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/snapshots/${applied.backupSnapshotId}/restore`,
        headers,
        payload: { baseRevision: current.revision },
      })
    ).statusCode,
    409,
  );
  project = after;
  const rejected = await create();
  assert.equal((await action(rejected.id, "reject")).statusCode, 200);
  assert.equal((await action(rejected.id, "apply")).statusCode, 409);
  for (scenario of ["fail", "invalid", "refuse"]) {
    const failed = await create();
    assert.equal(failed.status, scenario === "refuse" ? "refused" : "failed");
    assert.equal((await action(failed.id, "apply")).statusCode, 409);
    assert.equal((await get()).revision, project.revision);
  }
  const pendingInput = input();
  await projectRepository(database.pool).beginProposal(
    user,
    pendingInput,
    config.AI_MODEL,
  );
  await database.pool.query(
    "UPDATE ai_proposal SET data = data || $2::jsonb WHERE id = $1",
    [
      pendingInput.requestId,
      JSON.stringify({ createdAt: new Date(Date.now() - 60000).toISOString() }),
    ],
  );
  assert.equal(
    aiProposalSchema.parse(
      (
        await app.inject({
          url: `/api/ai-proposals/${pendingInput.requestId}`,
          headers,
        })
      ).json(),
    ).status,
    "expired",
  );
  // A full history must prevent edits if the safety snapshot cannot fit.
  scenario = "edit";
  const repository = projectRepository(database.pool);
  const fullId = await repository.create(user, "Full history fixture");
  let full = projectSchema.parse(await repository.get(user, fullId));
  for (let revision = 1; revision <= 20; revision++) {
    await repository.createSnapshot(user, fullId, full.revision);
    const first = full.files[0];
    assert.ok(first);
    await repository.save(
      user,
      fullId,
      first.id,
      first.version,
      `Revision ${revision}`,
    );
    full = projectSchema.parse(await repository.get(user, fullId));
  }
  const blocked = await create({
    ...input(),
    projectId: fullId,
    baseRevision: full.revision,
    fileIds: full.files.map((f) => f.id),
  });
  assert.equal((await action(blocked.id, "apply")).statusCode, 400);
  assert.deepEqual(
    projectSchema.parse(await repository.get(user, fullId)),
    full,
    "snapshot quota failure must roll back every edit",
  );
  const saved = await app.inject({
    method: "POST",
    url: "/api/resume-analyses",
    headers,
    payload: {
      extraction: extracted(),
      requirements: [{ text: "Java", kind: "required" }],
    },
  });
  assert.equal(saved.statusCode, 201, saved.body);
  const report = savedResumeSchema.parse(saved.json());
  assert.equal(report.report.matches[0]?.state, "not-found");
  assert.equal(report.attestation, "client-provided-extraction");
  assert.equal(
    (
      await app.inject({
        url: `/api/resume-analyses/${report.id}`,
        headers: foreign,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/resume-analyses/${report.id}`,
        headers: foreign,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/resume-analyses",
        headers,
        payload: {
          extraction: extracted(),
          requirements: [],
          report: { estimate: 100 },
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/resume-analyses/${report.id}`,
        headers,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ url: `/api/resume-analyses/${report.id}`, headers }))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/ai-proposals/${proposal.id}`,
        headers,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ url: `/api/ai-proposals/${proposal.id}`, headers }))
      .statusCode,
    404,
  );
  for (const path of ["/api/ai-proposals", "/api/resume-analyses"])
    assert.equal((await app.inject(path)).statusCode, 401);
  console.log(
    "Real PostgreSQL assistance/report checks passed: atomic multi-file apply, backups, idempotence, stale protection, ownership, refusal/failure, interruption recovery, and private reports.",
  );
} finally {
  await app.close();
  await database.pool.query(
    'DELETE FROM "user" WHERE email = ANY($1::text[])',
    [emails],
  );
  await database.close();
}
