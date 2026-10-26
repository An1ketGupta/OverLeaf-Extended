import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createProjectSchema,
  createSnapshotSchema,
  createTextFileSchema,
  restoreSnapshotSchema,
  templateCatalog,
} from "@overleaf-pro/contracts";
import { describe, expect, it } from "vitest";
import { sourceDiff } from "../../apps/web/src/features/workspace/diff.js";

describe("history input and source comparison", () => {
  it("rejects unsafe names, client snapshot bodies and unknown templates", () => {
    for (const name of ["", " ", "x\ny", "x\u0000y", "x".repeat(101)])
      expect(
        createSnapshotSchema.safeParse({ baseRevision: 1, name }).success,
      ).toBe(false);
    expect(
      createSnapshotSchema.parse({ baseRevision: 1, name: "  First draft  " })
        .name,
    ).toBe("First draft");
    expect(
      createSnapshotSchema.safeParse({ baseRevision: 1, files: [] }).success,
    ).toBe(false);
    expect(
      restoreSnapshotSchema.safeParse({ baseRevision: 1, content: "replace" })
        .success,
    ).toBe(false);
    expect(restoreSnapshotSchema.safeParse({ baseRevision: 0 }).success).toBe(
      false,
    );
    expect(
      createProjectSchema.safeParse({
        name: "Draft",
        templateId: "../../private",
      }).success,
    ).toBe(false);
  });
  it("shows directional source changes including Unicode, empty files and final newlines", () => {
    expect(sourceDiff("one\nold\nlast", "one\nnew\nlast")).toBe(
      "@@ -2,1 +2,1 @@\n- old\n+ new",
    );
    expect(sourceDiff("José", "Zoë")).toContain("- José\n+ Zoë");
    expect(sourceDiff("", "new")).toContain("+ new");
    expect(sourceDiff("same", "same")).toBe("No source changes.");
    expect(sourceDiff("line", "line\n")).toBe("@@ -2,0 +2,1 @@\n+ ");
  });
});

it("pins every catalog source and license, with bounded valid text inputs", async () => {
  const root = new URL("../../templates/", import.meta.url);
  const manifest: Record<string, string> = JSON.parse(
    await readFile(new URL("sha256.json", root), "utf8"),
  );
  const paths = [
    "LICENSE",
    ...templateCatalog.flatMap((item) =>
      item.files.map((path) => `${item.id}/${path}`),
    ),
  ];
  expect(Object.keys(manifest).sort()).toEqual(paths.sort());
  for (const path of paths) {
    const bytes = await readFile(new URL(path, root));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      manifest[path],
    );
    expect(
      createTextFileSchema.safeParse({
        baseRevision: 1,
        path,
        content: bytes.toString("utf8"),
      }).success,
    ).toBe(true);
  }
});
