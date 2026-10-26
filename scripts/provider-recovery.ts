import assert from "node:assert/strict";
import type { AiRequest } from "@overleaf-pro/contracts";
import { createAssistantProvider } from "../apps/api/src/assistant-provider.js";

const provider = createAssistantProvider({
  key: "synthetic-only",
  model: "openai/gpt-oss-20b",
  endpoint: "http://127.0.0.1:4910/assistant/openai/v1/chat/completions",
  timeoutMs: 500,
});
const file = {
  id: "00000000-0000-4000-8000-000000000001",
  path: "main.tex",
  version: 1,
  content: "Synthetic source only",
  sha256: "a".repeat(64),
};
const input: AiRequest = {
  requestId: "00000000-0000-4000-8000-000000000002",
  projectId: "00000000-0000-4000-8000-000000000003",
  baseRevision: 1,
  mode: "explain",
  instruction: "success",
  fileIds: [file.id],
  diagnostics: "",
  shareWithProvider: true,
};
assert.equal((await provider(input, [file])).result.edits.length, 0);
assert.equal(
  (await provider({ ...input, instruction: "refusal" }, [file])).result.refused,
  true,
);
for (const instruction of [
  "truncated",
  "malformed",
  "429",
  "503",
  "html",
  "hang",
])
  await assert.rejects(provider({ ...input, instruction }, [file]), /Provider/);
assert.equal((await provider(input, [file])).result.refused, false);
const unreachable = createAssistantProvider({
  key: "synthetic-only",
  model: "openai/gpt-oss-20b",
  endpoint: "http://127.0.0.1:1/openai/v1/chat/completions",
  timeoutMs: 500,
});
await assert.rejects(unreachable(input, [file]), /interrupted/);
console.log(
  "Provider recovery passed: real HTTP through Postman simulation, refusal, malformed/truncated output, 429/503/HTML, timeout, later success and unreachable transport.",
);
