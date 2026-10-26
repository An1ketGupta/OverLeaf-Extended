import { createHash, randomUUID } from "node:crypto";
import {
  importProjectSchema,
  type SourceSnapshot,
} from "@overleaf-pro/contracts";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { sourceArchive } from "./export.js";
import { readSourceBackup, storedBackupEntries } from "./import.js";

const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const snapshot: SourceSnapshot = {
  id: randomUUID(),
  projectId: randomUUID(),
  revision: 17,
  createdAt: new Date().toISOString(),
  mainFile: "nested/文.tex",
  files: ["nested/文.tex", "__proto__", `${"a".repeat(236)}.tex`].map(
    (path) => ({
      id: randomUUID(),
      path,
      version: 7,
      content: "Zoë 李\n",
      sha256: hash("Zoë 李\n"),
    }),
  ),
  assets: [
    {
      id: randomUUID(),
      path: "image.png",
      version: 2,
      mediaType: "image/png",
      bytes: png.length,
      sha256: hash(png),
      dataBase64: btoa(String.fromCharCode(...png)),
    },
  ],
};
async function rewritten(
  change: (entries: Record<string, Uint8Array>) => void,
) {
  const entries = unzipSync(await sourceArchive(snapshot));
  change(entries);
  return zipSync(entries, { level: 0 });
}
describe("bounded backup recovery", () => {
  it("reports malformed base64 as validation failure without throwing from shared refinements", () => {
    for (const dataBase64 of ["!!!!", "A===", "YQ", "_bad", ""]) {
      expect(
        importProjectSchema.safeParse({
          name: "Invalid asset",
          mainFile: "main.tex",
          files: [{ path: "main.tex", content: "" }],
          assets: [{ path: "image.png", dataBase64 }],
        }).success,
      ).toBe(false);
    }
  });
  it.each(["snapshot", "capture"] as const)(
    "round-trips %s backups with Unicode, maximum paths and assets without importing historical authority",
    async (kind) => {
      const bytes = await sourceArchive(snapshot, kind);
      const result = await readSourceBackup(bytes, "Recovered");
      expect(result).toEqual({
        name: "Recovered",
        mainFile: snapshot.mainFile,
        files: snapshot.files.map(({ path, content }) => ({ path, content })),
        assets: snapshot.assets.map(({ path, dataBase64 }) => ({
          path,
          dataBase64,
        })),
      });
      const manifest = JSON.parse(
        new TextDecoder().decode(
          storedBackupEntries(bytes).get("snapshot.json"),
        ),
      );
      expect(manifest.format).toBe(
        `overleaf-pro-source-v${kind === "capture" ? 2 : 1}`,
      );
    },
  );
  it("rejects changed bytes, missing or extra entries, traversal, false hashes and UTF-8 corruption", async () => {
    for (const change of [
      (entries: Record<string, Uint8Array>) => {
        entries["source/nested/文.tex"] = strToU8("tampered");
      },
      (entries: Record<string, Uint8Array>) => {
        delete entries["source/nested/文.tex"];
      },
      (entries: Record<string, Uint8Array>) => {
        entries["source/extra.tex"] = strToU8("extra");
      },
      (entries: Record<string, Uint8Array>) => {
        entries["source/../outside.tex"] = strToU8("unsafe");
      },
      (entries: Record<string, Uint8Array>) => {
        const manifest = JSON.parse(
          new TextDecoder().decode(entries["snapshot.json"]),
        );
        const bad = new Uint8Array([255]);
        entries["source/nested/文.tex"] = bad;
        manifest.files[0].sha256 = hash(bad);
        entries["snapshot.json"] = strToU8(JSON.stringify(manifest));
      },
    ])
      await expect(
        readSourceBackup(await rewritten(change), "Recovered"),
      ).rejects.toThrow("Invalid or unsupported");
  });
  it("rejects compressed archives, CRC failures, central/local disagreement, duplicate entries and forged expansion sizes", async () => {
    const archive = await sourceArchive(snapshot);
    await expect(
      readSourceBackup(zipSync(unzipSync(archive), { level: 6 }), "Recovered"),
    ).rejects.toThrow();
    for (const mutate of [
      (bytes: Uint8Array, _central: number) => {
        bytes[45] = (bytes[45] ?? 0) ^ 1;
      },
      (bytes: Uint8Array, central: number) => {
        new DataView(bytes.buffer).setUint32(central + 24, 0xffffffff, true);
      },
      (bytes: Uint8Array, central: number) => {
        new DataView(bytes.buffer).setUint32(central + 42, 1, true);
      },
      (bytes: Uint8Array, central: number) => {
        new DataView(bytes.buffer).setUint32(central + 38, 0xa0000000, true);
      },
    ]) {
      const bytes = archive.slice();
      const central = new DataView(bytes.buffer).getUint32(
        bytes.length - 6,
        true,
      );
      mutate(bytes, central);
      expect(() => storedBackupEntries(bytes)).toThrow();
    }
    expect(() =>
      storedBackupEntries(new Uint8Array(10 * 1024 * 1024)),
    ).toThrow();
  });
});
