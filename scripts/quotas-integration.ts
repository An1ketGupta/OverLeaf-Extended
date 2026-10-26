import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  aiRequestSchema,
  importProjectSchema,
  limits,
  projectSchema,
  resumeInputSchema,
} from "@overleaf-pro/contracts";
import {
  analysisRepository,
  createDatabase,
  projectRepository,
} from "@overleaf-pro/db";
import { analyzeResume } from "@overleaf-pro/resume";
import { extracted } from "../tests/fixtures/resume.js";
import { requireTestDatabase } from "./test-database.js";

const database = createDatabase(requireTestDatabase());
const users = [0, 1, 2].map(() => `part7-quota-${randomUUID()}`);
const repository = projectRepository(database.pool);
const analyses = analysisRepository(database.pool);
const simple = {
  name: "Quota fixture",
  mainFile: "main.tex",
  files: [{ path: "main.tex", content: "" }],
  assets: [],
};
try {
  await database.migrate();
  for (const id of users)
    await database.pool.query(
      'INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,$2,$3,true)',
      [id, "Synthetic quota fixture", `${id}@example.test`],
    );
  const user = users[0];
  const assetUser = users[1];
  const reportUser = users[2];
  assert.ok(user);
  assert.ok(assetUser);
  assert.ok(reportUser);
  // Cross-request count allocation: the last project slot can only be used once.
  for (let i = 0; i < 99; i++) await repository.importProject(user, simple);
  const countRace = await Promise.allSettled([
    repository.importProject(user, simple),
    repository.importProject(user, simple),
  ]);
  assert.equal(countRace.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await repository.list(user)).length, 100);
  const first = projectSchema.parse(
    await repository.get(user, (await repository.list(user))[0]?.id ?? ""),
  );
  await repository.delete(user, first.id, first.revision);
  await repository.importProject(user, simple);
  // Entry and decoded byte limits are enforced by the same API import contract.
  assert.ok(
    importProjectSchema.safeParse({
      ...simple,
      files: Array.from({ length: 50 }, (_, i) => ({
        path: i ? `f${i}.tex` : "main.tex",
        content: "",
      })),
    }).success,
  );
  assert.equal(
    importProjectSchema.safeParse({
      ...simple,
      files: Array.from({ length: 51 }, (_, i) => ({
        path: i ? `f${i}.tex` : "main.tex",
        content: "",
      })),
    }).success,
    false,
  );
  const image = Buffer.alloc(limits.assetBytes);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(image);
  const full = {
    ...simple,
    assets: Array.from({ length: 4 }, (_, i) => ({
      path: `image-${i}.png`,
      dataBase64: image.toString("base64"),
    })),
  };
  assert.ok(importProjectSchema.safeParse(full).success);
  assert.equal(
    importProjectSchema.safeParse({
      ...full,
      files: [{ path: "main.tex", content: "x" }],
    }).success,
    false,
  );
  assert.equal(
    importProjectSchema.safeParse({
      ...simple,
      assets: [
        {
          path: "large.png",
          dataBase64: Buffer.concat([image, Buffer.from([1])]).toString(
            "base64",
          ),
        },
      ],
    }).success,
    false,
  );
  const assetProjects = [];
  for (let i = 0; i < 4; i++)
    assetProjects.push(
      projectSchema.parse(await repository.importProject(assetUser, full)),
    );
  await assert.rejects(
    repository.importProject(assetUser, {
      ...simple,
      assets: [
        {
          path: "dot.png",
          dataBase64: image.subarray(0, 8).toString("base64"),
        },
      ],
    }),
    /asset storage limit/,
  );
  const deleted = assetProjects[0];
  assert.ok(deleted);
  await repository.delete(assetUser, deleted.id, deleted.revision);
  await repository.importProject(assetUser, full);
  // The reserved-byte proposal cap is reached before the 50-request count cap.
  const project = projectSchema.parse(
    await repository.importProject(reportUser, simple),
  );
  const proposalInput = () =>
    aiRequestSchema.parse({
      requestId: randomUUID(),
      projectId: project.id,
      baseRevision: 1,
      mode: "explain",
      instruction: "Synthetic quota",
      fileIds: [project.files[0]?.id],
      diagnostics: "",
      shareWithProvider: true,
    });
  const ids = [];
  for (let i = 0; i < 41; i++)
    ids.push(
      (
        await repository.beginProposal(
          reportUser,
          proposalInput(),
          "synthetic-quota",
        )
      ).proposal.id,
    );
  await assert.rejects(
    repository.beginProposal(reportUser, proposalInput(), "synthetic-quota"),
    /history is full/,
  );
  await repository.deleteProposal(reportUser, ids[0] ?? "");
  await repository.beginProposal(
    reportUser,
    proposalInput(),
    "synthetic-quota",
  );
  // Report count quota, then release and reuse capacity.
  const reportInput = resumeInputSchema.parse({
    extraction: extracted(),
    requirements: [],
  });
  const reportIds = [];
  for (let i = 0; i < 20; i++)
    reportIds.push(
      (await analyses.save(reportUser, reportInput, analyzeResume(reportInput)))
        .id,
    );
  await assert.rejects(
    analyses.save(reportUser, reportInput, analyzeResume(reportInput)),
    /report limit/,
  );
  await analyses.delete(reportUser, reportIds[0] ?? "");
  await analyses.save(reportUser, reportInput, analyzeResume(reportInput));
  for (const id of (await analyses.list(reportUser)).map((item) => item.id))
    await analyses.delete(reportUser, id);
  // Large escaped extraction reaches the byte limit below the report count cap.
  const large = resumeInputSchema.parse({
    extraction: {
      ...extracted(),
      lines: Array.from({ length: 50 }, (_, index) => ({
        page: 1,
        line: index + 1,
        text: "\u0001".repeat(2000),
        x: 0.1,
        y: index / 50,
      })),
    },
    requirements: [],
  });
  let reports = 0;
  while (true) {
    try {
      await analyses.save(reportUser, large, analyzeResume(large));
      reports++;
      assert.ok(reports < 20);
    } catch (error) {
      assert.match(error instanceof Error ? error.message : "", /report limit/);
      break;
    }
  }
  assert.ok(reports > 1 && reports < 20);
  const logical = await database.pool.query(
    "SELECT (SELECT COALESCE(sum(octet_length(data)),0)::text FROM project_asset WHERE project_id IN (SELECT id FROM project WHERE user_id=$1)) AS asset_bytes, (SELECT COALESCE(sum(bytes),0)::text FROM resume_analysis WHERE user_id=$2) AS report_bytes, (SELECT COALESCE(sum(pg_column_size(data)),0)::text FROM project_asset WHERE project_id IN (SELECT id FROM project WHERE user_id=$1)) AS stored_asset_column_bytes",
    [assetUser, reportUser],
  );
  await mkdir(".cache/part-7", { recursive: true });
  await writeFile(
    ".cache/part-7/storage.json",
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        reportByteLimitCount: reports,
        ...logical.rows[0],
        note: "Synthetic repeated binary compresses strongly; column sizes are not whole database disk use.",
      },
      null,
      2,
    ),
  );
  console.log(
    "Quota recovery passed: concurrent project allocation, input limits, real 32 MiB account assets, proposal reservation bytes, report count/bytes and cleanup reuse.",
  );
} finally {
  for (const id of users)
    await database.pool.query('DELETE FROM "user" WHERE id=$1', [id]);
  await database.close();
}
