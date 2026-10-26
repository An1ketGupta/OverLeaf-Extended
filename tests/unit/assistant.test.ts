import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type AiRequest, aiOutputSchema } from "@overleaf-pro/contracts";
import { describe, expect, it } from "vitest";
import {
  createAssistantProvider,
  validateAssistantOutput,
} from "../../apps/api/src/assistant-provider.js";

const file = {
  id: "00000000-0000-4000-8000-000000000001",
  path: "main.tex",
  content: "before SELECT after",
  version: 1,
  sha256: "a".repeat(64),
};
const input: AiRequest = {
  requestId: "00000000-0000-4000-8000-000000000002",
  projectId: "00000000-0000-4000-8000-000000000003",
  baseRevision: 1,
  mode: "rewrite",
  instruction: "Simplify",
  fileIds: [file.id],
  diagnostics: "",
  shareWithProvider: true,
};
describe("assistant safety and real HTTP provider adapter", () => {
  it("restricts targets, duplicate edits, explanation edits, and selected rewrites", () => {
    const output = {
      answer: "Review this",
      refused: false,
      edits: [{ fileId: file.id, content: "before NEW after" }],
    };
    expect(
      validateAssistantOutput(
        { ...input, selection: { fileId: file.id, from: 7, to: 13 } },
        [file],
        output,
      ),
    ).toEqual(output);
    expect(() =>
      validateAssistantOutput({ ...input, mode: "explain" }, [file], output),
    ).toThrow();
    expect(() =>
      validateAssistantOutput(
        { ...input, selection: { fileId: file.id, from: 7, to: 13 } },
        [file],
        { ...output, edits: [{ fileId: file.id, content: "overwritten" }] },
      ),
    ).toThrow();
    expect(() => validateAssistantOutput(input, [], output)).toThrow();
    expect(
      aiOutputSchema.safeParse({
        ...output,
        edits: [...output.edits, ...output.edits],
      }).success,
    ).toBe(false);
  });
  it("handles success, refusals, truncation, malformed JSON, 429, HTML failures, large output, timeout and unreachable upstreams", async () => {
    let scenario = "success";
    let requests = 0;
    const server = createServer(async (req, res) => {
      requests++;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      expect(req.url).toBe("/openai/v1/chat/completions");
      expect(req.headers.authorization).toBe("Bearer synthetic-key");
      expect(body.messages[0].content).toContain("untrusted data");
      expect(body.stream).toBe(false);
      expect(body.model).toBe("openai/gpt-oss-20b");
      expect(body.reasoning_effort).toBe("low");
      if (scenario === "hang") return;
      if (scenario === "429" || scenario === "html") {
        res.statusCode = scenario === "429" ? 429 : 502;
        res.end("<html>private-upstream-error</html>");
        return;
      }
      if (scenario === "large") {
        res.end("x".repeat(129000));
        return;
      }
      if (scenario === "malformed") {
        res.end("not JSON");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: scenario === "truncated" ? "length" : "stop",
              message: {
                content: JSON.stringify({
                  answer: "Explanation",
                  refused: false,
                  edits: [],
                }),
                refusal: scenario === "refused" ? "unsafe" : null,
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10 },
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/openai/v1/chat/completions`;
    const provider = createAssistantProvider({
      key: "synthetic-key",
      model: "openai/gpt-oss-20b",
      endpoint,
      timeoutMs: 500,
    });
    try {
      expect((await provider(input, [file])).usage).toEqual({
        inputTokens: 20,
        outputTokens: 10,
      });
      scenario = "refused";
      expect((await provider(input, [file])).result.refused).toBe(true);
      for (scenario of [
        "truncated",
        "malformed",
        "429",
        "html",
        "large",
        "hang",
      ])
        await expect(provider(input, [file])).rejects.toThrow(/Provider/);
      expect(requests).toBe(8);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await expect(provider(input, [file])).rejects.toThrow(/interrupted/);
  });
});
