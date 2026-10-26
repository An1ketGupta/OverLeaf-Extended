import { randomUUID } from "node:crypto";
import {
  assetBase64Schema,
  compileInputSchema,
  compilerManifestSchema,
} from "@overleaf-pro/contracts";
import { describe, expect, it } from "vitest";
import { diagnostics } from "../../apps/web/src/features/workspace/browser-compiler.js";

describe("compiler boundaries", () => {
  it("bounds serialized captures when JSON escaping expands valid source", () => {
    const id = randomUUID();
    const snapshot = {
      id,
      projectId: randomUUID(),
      revision: 1,
      mainFile: "main.tex",
      createdAt: new Date().toISOString(),
      assets: [],
      files: Array.from({ length: 12 }, (_, i) => ({
        id: randomUUID(),
        path: i ? `file${i}.tex` : "main.tex",
        version: 1,
        sha256: "a".repeat(64),
        content: "\u0001".repeat(256 * 1024),
      })),
    };
    expect(
      compileInputSchema.safeParse({
        kind: "ephemeral",
        captureId: id,
        snapshot,
      }).success,
    ).toBe(false);
  });
  it("keeps safe source locations and treats injected log HTML as plain bounded text", () => {
    const result = diagnostics(
      "./sections/test.tex:12: Undefined control sequence\n../outside.tex:9: bad\n! <script>untrusted()</script>\nPackage hyperref Warning: Rerun",
    );
    expect(result[0]).toMatchObject({
      path: "sections/test.tex",
      line: 12,
      severity: "error",
    });
    expect(result[1]).not.toHaveProperty("path");
    expect(result[2]?.message).toContain("<script>");
    expect(diagnostics(Array(200).fill("! error").join("\n"))).toHaveLength(
      100,
    );
  });
  it("rejects noncanonical base64 and arbitrary compiler asset URLs", () => {
    expect(assetBase64Schema.safeParse("YR==").success).toBe(false);
    expect(assetBase64Schema.safeParse("YQ==").success).toBe(true);
    expect(
      compilerManifestSchema.safeParse({
        buildId: "remote",
        shards: {
          engine: [{ path: "https://example.invalid/engine" }],
          runtime: [],
        },
      }).success,
    ).toBe(false);
  });
});
