import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAssistantProvider } from "../apps/api/src/assistant-provider.js";
import { readConfig } from "../apps/api/src/config.js";

// Explicit opt-in only. Sends original synthetic LaTeX, never user documents.
const config = readConfig();
if (
  process.env.AI_LIVE_CHECK !== "true" ||
  config.AI_SHARING_ENABLED !== "true" ||
  !config.GROQ_API_KEY
)
  throw new Error(
    "Set AI_LIVE_CHECK=true, AI_SHARING_ENABLED=true and a Groq Free account key to opt in. No paid tier or fallback is selected.",
  );
const file = {
  id: randomUUID(),
  path: "main.tex",
  version: 1,
  content: "\\section{Hello}\nSynthetic sample.",
  sha256: "a".repeat(64),
};
const output = await createAssistantProvider({
  key: config.GROQ_API_KEY,
  model: config.AI_MODEL,
})(
  {
    requestId: randomUUID(),
    projectId: randomUUID(),
    baseRevision: 1,
    mode: "explain",
    instruction: "Explain the section command",
    fileIds: [file.id],
    diagnostics: "",
    shareWithProvider: true,
  },
  [file],
);
assert.equal(output.result.edits.length, 0);
console.log(
  "Opt-in live synthetic explanation passed; output bodies omitted. This does not validate all rewrite quality or hosted behavior.",
);
