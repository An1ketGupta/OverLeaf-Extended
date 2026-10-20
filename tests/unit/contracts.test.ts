import { randomUUID } from "node:crypto";
import {
  projectPathSchema,
  sourceSnapshotSchema,
} from "@overleaf-pro/contracts";
import { describe, expect, it } from "vitest";
import { requireTestDatabase } from "../../scripts/test-database.js";

describe("untrusted project boundaries", () => {
  it.each([
    "../secret",
    "/etc/passwd",
    "C:/windows",
    "a\\b",
    "a//b",
    "./main.tex",
    "a/../main.tex",
    "a\u0000.tex",
  ])("rejects path %s", (path) => {
    expect(projectPathSchema.safeParse(path).success).toBe(false);
  });
  it("rejects UTF-8 byte overflow rather than counting characters", () => {
    const snapshot = {
      id: randomUUID(),
      projectId: randomUUID(),
      revision: 1,
      mainFile: "main.tex",
      createdAt: new Date().toISOString(),
      files: [
        {
          id: randomUUID(),
          path: "main.tex",
          version: 1,
          sha256: "a".repeat(64),
          content: "é".repeat(140_000),
        },
      ],
      assets: [],
    };
    expect(sourceSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
  it("rejects ambiguous paths and missing entrypoints", () => {
    const file = {
      id: randomUUID(),
      path: "main.tex",
      version: 1,
      sha256: "a".repeat(64),
      content: "hello",
    };
    const snapshot = {
      id: randomUUID(),
      projectId: randomUUID(),
      revision: 1,
      mainFile: "main.tex",
      createdAt: new Date().toISOString(),
      files: [file],
      assets: [],
    };
    expect(sourceSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      sourceSnapshotSchema.safeParse({
        ...snapshot,
        files: [file, { ...file, id: randomUUID() }],
      }).success,
    ).toBe(false);
    expect(
      sourceSnapshotSchema.safeParse({ ...snapshot, mainFile: "missing.tex" })
        .success,
    ).toBe(false);
    expect(
      sourceSnapshotSchema.safeParse({
        ...snapshot,
        files: [file, { ...file, path: "other.tex" }],
      }).success,
    ).toBe(false);
    expect(
      sourceSnapshotSchema.safeParse({
        ...snapshot,
        files: [
          file,
          { ...file, id: randomUUID(), path: "main.tex/child.tex" },
        ],
      }).success,
    ).toBe(false);
  });
  it("refuses test database aliases of the development database", () => {
    expect(() =>
      requireTestDatabase({
        DATABASE_URL: "postgres://u:p@branch.neon.tech/app",
        TEST_DATABASE_URL: "postgres://u:p@branch-pooler.neon.tech/app",
      }),
    ).toThrow("separate");
    expect(() =>
      requireTestDatabase({
        DATABASE_URL: "postgres://localhost/app",
        TEST_DATABASE_URL: "postgres://127.0.0.1/app",
      }),
    ).toThrow("separate");
    expect(() => requireTestDatabase({})).toThrow("required");
  });
});
