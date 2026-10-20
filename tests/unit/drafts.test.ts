import { randomUUID } from "node:crypto";
import type { LocalDraft } from "@overleaf-pro/contracts";
import { afterEach, expect, it, vi } from "vitest";
import {
  clearPrivateDrafts,
  readDrafts,
  writeDraft,
} from "../../apps/web/src/features/workspace/drafts.js";

function memoryStorage() {
  const values: Record<string, string> = {};
  Object.defineProperties(values, {
    setItem: {
      value: (key: string, value: string) => {
        values[key] = value;
      },
    },
    getItem: { value: (key: string) => values[key] ?? null },
    removeItem: {
      value: (key: string) => {
        delete values[key];
      },
    },
  });
  return values as unknown as Storage;
}
afterEach(() => vi.unstubAllGlobals());
it("bounds recovery by account, TTL and logout, while skipping corrupted records", () => {
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("localStorage", memoryStorage());
  sessionStorage.setItem("overleaf-pro:draft:corrupt", "broken json");
  const draft: LocalDraft = {
    userId: "owner",
    projectId: randomUUID(),
    fileId: randomUUID(),
    baseVersion: 1,
    content: "private",
    savedAt: Date.now() - 1000,
  };
  expect(writeDraft(draft)).toBe(true);
  expect(
    writeDraft({
      ...draft,
      fileId: randomUUID(),
      savedAt: Date.now() - 25 * 60 * 60 * 1000,
    }),
  ).toBe(true);
  expect(
    writeDraft({ ...draft, userId: "other-account", fileId: randomUUID() }),
  ).toBe(true);
  expect(readDrafts("owner", draft.projectId)).toEqual([draft]);
  expect(Object.keys(sessionStorage)).toHaveLength(1);
  localStorage.setItem("overleaf-pro:logout", `${Date.now()}:logout-event`);
  expect(readDrafts("owner", draft.projectId)).toEqual([]);
  expect(Object.keys(sessionStorage)).toHaveLength(0);
  writeDraft({ ...draft, savedAt: Date.now() + 1 });
  sessionStorage.setItem("unrelated", "keep");
  clearPrivateDrafts();
  expect(sessionStorage.getItem("unrelated")).toBe("keep");
  expect(Object.keys(sessionStorage)).toHaveLength(1);
});
it("reports unavailable storage instead of claiming draft recovery succeeded", () => {
  vi.stubGlobal("sessionStorage", {
    setItem: () => {
      throw new Error("Quota exceeded");
    },
  });
  expect(
    writeDraft({
      userId: "owner",
      projectId: randomUUID(),
      fileId: randomUUID(),
      baseVersion: 1,
      content: "private",
      savedAt: Date.now(),
    }),
  ).toBe(false);
});
