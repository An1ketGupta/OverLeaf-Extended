import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { AiOutput, AiRequest } from "@overleaf-pro/contracts";
import { createAssistantProvider } from "../apps/api/src/assistant-provider.js";
import { readConfig } from "../apps/api/src/config.js";
import { compileSynthetic, withBrowserCompiler } from "./browser-validation.js";

const config = readConfig();
if (
  process.env.AI_LIVE_CHECK !== "true" ||
  config.AI_SHARING_ENABLED !== "true" ||
  !config.GROQ_API_KEY
)
  throw new Error(
    "Opt in with AI_LIVE_CHECK=true, AI_SHARING_ENABLED=true and an eligible Groq Free key. Synthetic fixtures only; no retries or paid fallback.",
  );

const content =
  "\\documentclass{article}\n\\begin{document}\n\\section*{Skills}\nTypeScript.\n\\par Original sentence.\n\\end{document}\n";
const file = {
  id: randomUUID(),
  path: "main.tex",
  version: 1,
  content,
  sha256: createHash("sha256").update(content).digest("hex"),
};
const provider = createAssistantProvider({
  key: config.GROQ_API_KEY,
  model: config.AI_MODEL,
});
const directory = ".cache/ai-live";
await mkdir(directory, { recursive: true });
const results: Record<string, unknown>[] = [];
const review: { id: string; output: AiOutput }[] = [];
let caseId = "setup";
try {
  const models = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${config.GROQ_API_KEY}` },
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  assert.ok(models.ok, "Provider model availability check failed");
  const available = (await models.json()) as { data: { id: string }[] };
  assert.ok(
    available.data.some((model) => model.id === config.AI_MODEL),
    "Configured model is unavailable; no inference attempted",
  );
  await withBrowserCompiler(async (page) => {
    const brokenSource = content.replace(
      "Original sentence.",
      "\\UnknownLiveCommand",
    );
    const broken = await compileSynthetic(page, brokenSource);
    assert.equal(broken.state, "failed");
    const diagnostics = broken.diagnostics
      .map((item) => item.message)
      .join("\n")
      .slice(0, 4000);
    assert.match(diagnostics, /Undefined control sequence/);
    const selection = {
      fileId: file.id,
      from: content.indexOf("Original sentence."),
      to: content.indexOf("Original sentence.") + "Original sentence.".length,
    };
    const cases: {
      id: string;
      mode: AiRequest["mode"];
      instruction: string;
      selection?: AiRequest["selection"];
      diagnostics?: string;
      broken?: boolean;
      expected?: string;
      answer?: RegExp;
    }[] = [
      {
        id: "explain",
        mode: "explain",
        instruction:
          "Briefly explain the section command used in the supplied source.",
        answer: /section|heading/i,
      },
      {
        id: "question",
        mode: "question",
        instruction:
          "Which programming language is explicitly listed under Skills? Answer using only supplied facts.",
        answer: /TypeScript/,
      },
      {
        id: "selected-rewrite",
        mode: "rewrite",
        instruction:
          "Replace only the selected sentence with exactly: Clear synthetic sentence. Preserve every byte outside the selection.",
        selection,
        expected: "Clear synthetic sentence.",
      },
      {
        id: "generation",
        mode: "generate",
        instruction:
          "Add a Projects section before the document ends, containing exactly the visible text Synthetic Catalog. This is a fictional document fixture. Preserve the existing text and return the complete replacement file.",
        expected: "Synthetic Catalog",
      },
      {
        id: "diagnostic",
        mode: "diagnostic",
        instruction:
          "Explain this actual compiler failure and suggest a safe correction. Do not propose file edits or claim compilation succeeded.",
        diagnostics,
        broken: true,
        answer: /undefined|unknown|not defined|unrecognized/i,
      },
      {
        id: "missing-facts",
        mode: "question",
        instruction:
          "No measured results are available. What percentage improvement should I claim on my resume? Ask for the missing evidence; do not invent a number.",
        answer: /measur|evidence|verif|data|actual|quantif/i,
      },
    ];
    assert.equal(cases.length, 6);
    for (const entry of cases) {
      caseId = entry.id;
      const source = entry.broken
        ? {
            ...file,
            content: brokenSource,
            sha256: createHash("sha256").update(brokenSource).digest("hex"),
          }
        : file;
      const input: AiRequest = {
        requestId: randomUUID(),
        projectId: randomUUID(),
        baseRevision: 1,
        mode: entry.mode,
        instruction: entry.instruction,
        fileIds: [file.id],
        diagnostics: entry.diagnostics ?? "",
        shareWithProvider: true,
        ...(entry.selection ? { selection: entry.selection } : {}),
      };
      const started = performance.now();
      const output = await provider(input, [source]);
      assert.equal(output.result.refused, false);
      review.push({ id: entry.id, output: output.result });
      let compilation: Record<string, unknown> | undefined;
      if (entry.expected) {
        assert.equal(output.result.edits.length, 1);
        const edited = output.result.edits[0];
        assert.ok(edited);
        assert.notEqual(edited.content, source.content);
        if (entry.selection)
          assert.equal(
            edited.content,
            content.slice(0, selection.from) +
              entry.expected +
              content.slice(selection.to),
          );
        const result = await compileSynthetic(page, edited.content);
        assert.equal(result.state, "succeeded");
        assert.ok(
          result.text.includes(entry.expected),
          "Requested visible content absent from actual PDF",
        );
        assert.ok(
          result.text.includes("TypeScript"),
          "Unrelated skills text was lost",
        );
        await writeFile(
          `${directory}/${entry.id}.pdf`,
          Buffer.from(result.pdf),
        );
        compilation = {
          compilerBuildId: result.compilerBuildId,
          pdfSha256: result.pdfSha256,
        };
      } else {
        assert.equal(output.result.edits.length, 0);
        assert.ok(
          entry.answer?.test(output.result.answer),
          "Expected factual explanation absent",
        );
        if (entry.id === "missing-facts")
          assert.doesNotMatch(output.result.answer, /\d+(?:\.\d+)?\s*%/);
      }
      results.push({
        id: entry.id,
        passed: true,
        caseDurationMs: Math.round(performance.now() - started),
        usage: output.usage,
        ...compilation,
      });
      console.log(
        "Live synthetic case " +
          entry.id +
          ": passed (response bodies omitted).",
      );
    }
  });
} catch (error) {
  results.push({
    id: caseId,
    passed: false,
    reason:
      error instanceof Error && /^Provider /.test(error.message)
        ? error.message
        : `Synthetic validation failure (${error instanceof Error ? error.name : "unknown"}); stopped without retry.`,
  });
  process.exitCode = 1;
  console.error(
    "Live synthetic case " +
      caseId +
      " failed; stopped without retry. See bounded local evidence.",
  );
} finally {
  await writeFile(
    `${directory}/results.json`,
    `${JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        model: config.AI_MODEL,
        promptVersion: "latex-assistant-v1",
        results,
      },
      null,
      2,
    )}\n`,
  );
  // Original synthetic responses only, for local manual quality review. Never uploaded.
  await writeFile(
    `${directory}/review.json`,
    `${JSON.stringify(review, null, 2)}\n`,
  );
}
